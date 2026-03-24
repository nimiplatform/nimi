import { isRendererDebugEnabledForCurrentEnv } from './env.js';
import { isJsonObject } from './types.js';
import type { JsonObject, RendererLogPayload } from './types.js';

const MAX_RENDERER_DEBUG_LOGS = 80;
const MAX_SANITIZE_DEPTH = 6;
const MAX_SANITIZE_ARRAY_ITEMS = 32;
const MAX_SANITIZE_OBJECT_KEYS = 48;
const MAX_STRING_CHARS = 2048;
const rendererDebugLogs: JsonObject[] = [];
const REDACTED_VALUE = '[REDACTED]';
const UNSERIALIZABLE_VALUE = '[UNSERIALIZABLE]';
const CIRCULAR_VALUE = '[CIRCULAR]';
const TRUNCATED_VALUE = '[TRUNCATED]';

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (normalized === 'sessiontraceid') {
    return false;
  }
  return normalized === 'authorization'
    || normalized === 'cookie'
    || normalized.includes('bearer')
    || normalized.includes('credential')
    || normalized.includes('jwt')
    || normalized.includes('password')
    || normalized.includes('passwd')
    || normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('apikey')
    || normalized.includes('api_key')
    || normalized.includes('access_key')
    || normalized.includes('client_secret')
    || normalized.includes('private_key')
    || normalized.includes('session');
}

function sanitizeLogValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth >= MAX_SANITIZE_DEPTH) {
    return TRUNCATED_VALUE;
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}${TRUNCATED_VALUE}` : value;
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
    const sanitized = value
      .slice(0, MAX_SANITIZE_ARRAY_ITEMS)
      .map((entry) => sanitizeLogValue(entry, seen, depth + 1));
    if (value.length > MAX_SANITIZE_ARRAY_ITEMS) {
      sanitized.push(TRUNCATED_VALUE);
    }
    return sanitized;
  }

  const sanitized: JsonObject = {};
  const entries = Object.entries(value);
  for (const [key, entry] of entries.slice(0, MAX_SANITIZE_OBJECT_KEYS)) {
    sanitized[key] = isSensitiveKey(key)
      ? REDACTED_VALUE
      : sanitizeLogValue(entry, seen, depth + 1);
  }
  if (entries.length > MAX_SANITIZE_OBJECT_KEYS) {
    sanitized.__truncated__ = TRUNCATED_VALUE;
  }
  return sanitized;
}

function sanitizeLogDetails(details: unknown): JsonObject {
  if (!isJsonObject(details)) {
    return {};
  }
  const sanitized = sanitizeLogValue(details, new WeakSet<object>(), 0);
  return isJsonObject(sanitized) ? sanitized : {};
}

export function persistRendererLogForDebug(payload: RendererLogPayload): void {
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
  if (!isRendererDebugEnabledForCurrentEnv()) {
    return;
  }
  try {
    const runtimeWindow = window as typeof window & {
      __NIMI_RENDERER_DEBUG_LOGS__?: JsonObject[];
      __NIMI_RENDERER_DEBUG_LOGS_LATEST__?: JsonObject;
    };
    runtimeWindow.__NIMI_RENDERER_DEBUG_LOGS__ = rendererDebugLogs.slice();
    runtimeWindow.__NIMI_RENDERER_DEBUG_LOGS_LATEST__ = record;
  } catch {
    // ignore
  }
}

export { sanitizeLogDetails };

export function getRendererDebugLogsForTest(): JsonObject[] {
  return [...rendererDebugLogs];
}

export function resetRendererDebugBufferForTest(): void {
  rendererDebugLogs.splice(0, rendererDebugLogs.length);
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
