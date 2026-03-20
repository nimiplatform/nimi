import {
  hasTauriInvoke,
  RENDERER_DEBUG_ENABLED,
  isRendererDebugEnabledForCurrentEnv,
  shouldForwardRendererLogLevel,
} from './env';
import { isJsonObject } from './shared.js';
import type { JsonObject, RendererLogLevel, RendererLogMessage, RendererLogPayload } from './types';

const MAX_RENDERER_DEBUG_LOGS = 80;
const RENDERER_TRACE_SESSION_KEY = 'nimi.renderer.trace.sessionId.v1';
const RENDERER_CONSOLE_DEDUP_MS = 1200;
const RENDERER_CONSOLE_CACHE_LIMIT = 400;
const rendererConsoleMirrorAt = new Map<string, number>();
const rendererDebugLogs: JsonObject[] = [];
let rendererSessionTraceIdCache = '';
const REDACTED_VALUE = '[REDACTED]';
const UNSERIALIZABLE_VALUE = '[UNSERIALIZABLE]';
const CIRCULAR_VALUE = '[CIRCULAR]';

function requireSecureCrypto(): Crypto {
  if (typeof globalThis.crypto === 'undefined') {
    throw new Error('Secure random generator is unavailable');
  }
  return globalThis.crypto;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized === 'authorization'
    || normalized === 'cookie'
    || normalized.includes('password')
    || normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('apikey')
    || normalized.includes('api_key')
    || normalized.includes('session');
}

function sanitizeLogValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : UNSERIALIZABLE_VALUE;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return UNSERIALIZABLE_VALUE;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : UNSERIALIZABLE_VALUE;
  }
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || '',
    };
  }
  if (!value || typeof value !== 'object') {
    return UNSERIALIZABLE_VALUE;
  }
  if (seen.has(value)) {
    return CIRCULAR_VALUE;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogValue(entry, seen));
  }
  const sanitized: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key)
      ? REDACTED_VALUE
      : sanitizeLogValue(entry, seen);
  }
  return sanitized;
}

function sanitizeLogDetails(details: unknown): JsonObject {
  if (!isJsonObject(details)) {
    return {};
  }
  const sanitized = sanitizeLogValue(details, new WeakSet<object>());
  return isJsonObject(sanitized) ? sanitized : {};
}

function newTraceToken(prefix = 'renderer-session'): string {
  const secureCrypto = requireSecureCrypto();
  if (typeof secureCrypto.randomUUID === 'function') {
    return `${prefix}-${secureCrypto.randomUUID().replace(/-/g, '')}`;
  }
  const bytes = new Uint8Array(12);
  secureCrypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${suffix}`;
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
      __NIMI_RENDERER_DEBUG_LOGS__?: JsonObject[];
      __NIMI_RENDERER_DEBUG_LOGS_LATEST__?: JsonObject;
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
    if (!isRendererDebugEnabledForCurrentEnv()) return false;
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

  if (normalized.level === 'debug' && !isRendererDebugEnabledForCurrentEnv()) {
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
    if (RENDERER_DEBUG_ENABLED || isRendererDebugEnabledForCurrentEnv()) {
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
  details?: JsonObject;
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

export function getRendererDebugLogsForTest(): JsonObject[] {
  return [...rendererDebugLogs];
}

export function resetRendererTelemetryStateForTest(): void {
  rendererConsoleMirrorAt.clear();
  rendererDebugLogs.splice(0, rendererDebugLogs.length);
  rendererSessionTraceIdCache = '';
  try {
    const runtimeWindow = window as typeof window & {
      __NIMI_RENDERER_DEBUG_LOGS__?: JsonObject[];
      __NIMI_RENDERER_DEBUG_LOGS_LATEST__?: JsonObject;
    };
    runtimeWindow.__NIMI_RENDERER_DEBUG_LOGS__ = [];
    delete runtimeWindow.__NIMI_RENDERER_DEBUG_LOGS_LATEST__;
  } catch {
    // ignore
  }
}
