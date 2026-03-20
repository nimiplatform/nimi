import { isJsonObject } from './types.js';
import type { JsonObject, RendererLogPayload } from './types.js';

const MAX_RENDERER_DEBUG_LOGS = 80;
const rendererDebugLogs: JsonObject[] = [];

function sanitizeLogDetails(details: unknown): JsonObject {
  if (!isJsonObject(details)) {
    return {};
  }
  try {
    return isJsonObject(JSON.parse(JSON.stringify(details)))
      ? (JSON.parse(JSON.stringify(details)) as JsonObject)
      : {};
  } catch {
    return { raw: String(details) };
  }
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
