import {
  hasTauriInvoke,
  RENDERER_DEBUG_ENABLED,
  shouldForwardRendererLogLevel,
} from './env';
import type { RendererLogLevel, RendererLogMessage, RendererLogPayload } from './types';

const MAX_RENDERER_DEBUG_LOGS = 80;
const RENDERER_TRACE_SESSION_KEY = 'nimi.renderer.trace.sessionId.v1';
const RENDERER_CONSOLE_DEDUP_MS = 1200;
const RENDERER_CONSOLE_CACHE_LIMIT = 400;
const rendererConsoleMirrorAt = new Map<string, number>();
const rendererDebugLogs: Array<Record<string, unknown>> = [];
let rendererSessionTraceIdCache = '';

function sanitizeLogDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== 'object') {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(details)) as Record<string, unknown>;
  } catch {
    return { raw: String(details) };
  }
}

function newTraceToken(prefix = 'renderer-session'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveRendererSessionTraceId(): string {
  const fromWindow = String(window.__NIMI_HTML_BOOT_ID__ || '').trim();
  if (fromWindow) return fromWindow;

  if (rendererSessionTraceIdCache) {
    return rendererSessionTraceIdCache;
  }

  try {
    const fromSession = String(sessionStorage.getItem(RENDERER_TRACE_SESSION_KEY) || '').trim();
    if (fromSession) {
      rendererSessionTraceIdCache = fromSession;
      return fromSession;
    }
  } catch {
    // ignore
  }

  const created = newTraceToken();
  rendererSessionTraceIdCache = created;
  try {
    sessionStorage.setItem(RENDERER_TRACE_SESSION_KEY, created);
  } catch {
    // ignore
  }
  return created;
}

function persistRendererLogForDebug(payload: RendererLogPayload): void {
  const record = {
    ts: new Date().toISOString(),
    level: payload.level,
    area: payload.area,
    message: payload.message,
    traceId: payload.traceId,
    flowId: payload.flowId,
    source: payload.source,
    costMs: payload.costMs,
    details: sanitizeLogDetails(payload.details),
  };

  rendererDebugLogs.push(record);
  if (rendererDebugLogs.length > MAX_RENDERER_DEBUG_LOGS) {
    rendererDebugLogs.splice(0, rendererDebugLogs.length - MAX_RENDERER_DEBUG_LOGS);
  }
  try {
    const runtimeWindow = window as typeof window & {
      __NIMI_RENDERER_DEBUG_LOGS__?: Array<Record<string, unknown>>;
      __NIMI_RENDERER_DEBUG_LOGS_LATEST__?: Record<string, unknown>;
    };
    runtimeWindow.__NIMI_RENDERER_DEBUG_LOGS__ = [...rendererDebugLogs];
    runtimeWindow.__NIMI_RENDERER_DEBUG_LOGS_LATEST__ = record;
  } catch {
    // ignore
  }
}

function shouldMirrorRendererLogToConsole(
  level: RendererLogLevel,
  area: string,
  message: string,
): boolean {
  if (level === 'debug' || level === 'info') {
    if (!RENDERER_DEBUG_ENABLED) return false;
    const key = `${level}:${area}:${message}`;
    const now = Date.now();
    const previous = rendererConsoleMirrorAt.get(key) || 0;
    rendererConsoleMirrorAt.set(key, now);
    if (rendererConsoleMirrorAt.size > RENDERER_CONSOLE_CACHE_LIMIT) {
      rendererConsoleMirrorAt.clear();
    }
    return now - previous >= RENDERER_CONSOLE_DEDUP_MS;
  }
  return true;
}

export function toRendererLogMessage(message: unknown): RendererLogMessage {
  const normalized = String(message || '').trim();
  if (normalized.startsWith('action:') || normalized.startsWith('phase:')) {
    return normalized as RendererLogMessage;
  }
  if (!normalized) {
    return 'action:renderer-log:empty-message';
  }
  return `action:${normalized}` as RendererLogMessage;
}

export async function emitRendererLog(payload: RendererLogPayload): Promise<void> {
  const sessionTraceId = resolveRendererSessionTraceId();
  const normalizedTraceId =
    (payload.traceId && String(payload.traceId).trim()) ||
    (payload.flowId && String(payload.flowId).trim()) ||
    sessionTraceId;
  const normalizedFlowId =
    (payload.flowId && String(payload.flowId).trim()) ||
    normalizedTraceId;

  const normalized: RendererLogPayload = {
    level: payload.level,
    area: String(payload.area || 'renderer'),
    message: toRendererLogMessage(payload.message),
    traceId: normalizedTraceId,
    flowId: normalizedFlowId,
    source: payload.source ? String(payload.source) : undefined,
    costMs: typeof payload.costMs === 'number' ? Number(payload.costMs) : undefined,
    details: {
      ...sanitizeLogDetails(payload.details),
      sessionTraceId,
    },
  };

  if (normalized.level === 'debug' && !RENDERER_DEBUG_ENABLED) {
    return;
  }

  persistRendererLogForDebug(normalized);

  if (shouldMirrorRendererLogToConsole(normalized.level, normalized.area, normalized.message)) {
    persistRendererLogForDebug({
      ...normalized,
      area: `${normalized.area}.console-mirror`,
    });
  }

  if (!shouldForwardRendererLogLevel(normalized.level)) {
    return;
  }

  if (!hasTauriInvoke()) {
    return;
  }

  const invokeFn = window.__TAURI__?.core?.invoke;
  if (typeof invokeFn !== 'function') {
    return;
  }

  try {
    await invokeFn('log_renderer_event', {
      payload: normalized,
    });
  } catch (error) {
    if (RENDERER_DEBUG_ENABLED) {
      persistRendererLogForDebug({
        ...normalized,
        level: 'warn',
        area: `${normalized.area}.invoke-failed`,
        details: {
          ...normalized.details,
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    }
  }
}

export function logRendererEvent(payload: {
  level?: RendererLogLevel;
  area: string;
  message: RendererLogMessage;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
}): void {
  const normalizedLevel = payload.level || 'info';
  const normalizedArea = String(payload.area || 'renderer');
  const normalizedMessage = toRendererLogMessage(payload.message);
  const level = ['debug', 'info', 'warn', 'error'].includes(normalizedLevel)
    ? (normalizedLevel as RendererLogLevel)
    : 'info';

  void emitRendererLog({
    level,
    area: normalizedArea,
    message: normalizedMessage,
    traceId: payload.traceId,
    flowId: payload.flowId,
    source: payload.source,
    costMs: payload.costMs,
    details: payload.details,
  });
}
