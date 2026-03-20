import { isJsonObject } from './types.js';
import type { JsonObject, RendererLogPayload } from './types.js';

const MAX_RENDERER_DEBUG_LOGS = 80;
const rendererDebugLogs: JsonObject[] = [];
const REDACTED_VALUE = '[REDACTED]';
const UNSERIALIZABLE_VALUE = '[UNSERIALIZABLE]';
const CIRCULAR_VALUE = '[CIRCULAR]';

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
