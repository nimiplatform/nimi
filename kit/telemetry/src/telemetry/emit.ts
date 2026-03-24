import {
  hasTauriInvoke,
  RENDERER_DEBUG_ENABLED,
  isRendererDebugEnabledForCurrentEnv,
  shouldForwardRendererLogLevel,
} from './env.js';
import { persistRendererLogForDebug, sanitizeLogDetails } from './debug-buffer.js';
import { resolveRendererSessionTraceId } from './session-trace.js';
import type { JsonObject, RendererLogLevel, RendererLogMessage, RendererLogPayload } from './types.js';

const RENDERER_CONSOLE_DEDUP_MS = 1200;
const RENDERER_CONSOLE_CACHE_LIMIT = 400;
const rendererConsoleMirrorAt = new Map<string, number>();

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

function mirrorRendererLogToConsole(payload: RendererLogPayload): void {
  const details = payload.details && Object.keys(payload.details).length > 0
    ? payload.details
    : undefined;
  const args = details ? [payload.message, details] : [payload.message];
  switch (payload.level) {
    case 'debug':
      console.debug(...args);
      return;
    case 'warn':
      console.warn(...args);
      return;
    case 'error':
      console.error(...args);
      return;
    default:
      console.info(...args);
  }
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
    mirrorRendererLogToConsole(normalized);
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
  message: RendererLogMessage | string;
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
  }).catch((error) => {
    if (RENDERER_DEBUG_ENABLED || isRendererDebugEnabledForCurrentEnv()) {
      persistRendererLogForDebug({
        level: 'warn',
        area: `${normalizedArea}.emit-rejected`,
        message: 'action:renderer-log:emit-rejected',
        traceId: payload.traceId,
        flowId: payload.flowId,
        source: payload.source,
        costMs: payload.costMs,
        details: {
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    }
  });
}

export function resetRendererEmitStateForTest(): void {
  rendererConsoleMirrorAt.clear();
}
