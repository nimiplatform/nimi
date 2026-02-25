import { hasTauriInvoke, RENDERER_DEBUG_ENABLED } from './env';
import type { RendererLogLevel, RendererLogMessage, RendererLogPayload } from './types';

const RENDERER_BOOT_DEBUG_KEY = 'nimi.renderer.debug.logs.v1';
const MAX_RENDERER_DEBUG_LOGS = 80;
const RENDERER_TRACE_SESSION_KEY = 'nimi.renderer.trace.sessionId.v1';
const RENDERER_CONSOLE_DEDUP_MS = 1200;
const RENDERER_CONSOLE_CACHE_LIMIT = 400;
const rendererConsoleMirrorAt = new Map<string, number>();

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

  try {
    const fromSession = String(sessionStorage.getItem(RENDERER_TRACE_SESSION_KEY) || '').trim();
    if (fromSession) return fromSession;
  } catch {
    // ignore
  }

  try {
    const fromLocal = String(localStorage.getItem(RENDERER_TRACE_SESSION_KEY) || '').trim();
    if (fromLocal) return fromLocal;
  } catch {
    // ignore
  }

  const created = newTraceToken();
  try {
    sessionStorage.setItem(RENDERER_TRACE_SESSION_KEY, created);
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(RENDERER_TRACE_SESSION_KEY, created);
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

  try {
    const raw = localStorage.getItem(RENDERER_BOOT_DEBUG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const normalized = Array.isArray(list) ? list.slice(-MAX_RENDERER_DEBUG_LOGS + 1) : [];
    normalized.push(record);
    localStorage.setItem(RENDERER_BOOT_DEBUG_KEY, JSON.stringify(normalized));
    localStorage.setItem(`${RENDERER_BOOT_DEBUG_KEY}:latest`, JSON.stringify(record));
  } catch {
    // localStorage may be unavailable in some contexts; ignore.
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
