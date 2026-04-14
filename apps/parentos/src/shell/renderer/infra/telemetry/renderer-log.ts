import { hasTauriRuntime, invokeTauri } from '../../bridge/index.js';

export type ParentosRendererLogLevel = 'debug' | 'info' | 'warn' | 'error';

type JsonObject = Record<string, unknown>;

type ParentosRendererLogPayload = {
  level: ParentosRendererLogLevel;
  area: string;
  message: string;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: JsonObject;
};

let globalErrorLoggingInstalled = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '[UNSERIALIZABLE]';
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return '[UNSERIALIZABLE]';
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : '[UNSERIALIZABLE]';
  }
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || '',
      stack: value.stack || '',
      cause: sanitizeValue(value.cause, seen),
    };
  }
  if (!value || typeof value !== 'object') {
    return '[UNSERIALIZABLE]';
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }
  const next: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = sanitizeValue(entry, seen);
  }
  return next;
}

function sanitizeDetails(details: unknown): JsonObject {
  if (!isRecord(details)) {
    return {};
  }
  const sanitized = sanitizeValue(details, new WeakSet<object>());
  return isRecord(sanitized) ? sanitized : {};
}

export function describeError(error: unknown): JsonObject {
  if (error instanceof Error) {
    return sanitizeDetails({
      name: error.name || 'Error',
      message: error.message || '',
      stack: error.stack || '',
      cause: error.cause,
    });
  }
  return {
    message: String(error || 'unknown error'),
  };
}

function consoleMethod(level: ParentosRendererLogLevel): (...args: unknown[]) => void {
  const logger = globalThis.console;
  if (!logger) return () => {};
  if (level === 'error') return logger.error.bind(logger);
  if (level === 'warn') return logger.warn.bind(logger);
  if (level === 'debug') return logger.debug.bind(logger);
  return logger.info.bind(logger);
}

export function logRendererEvent(input: {
  level?: ParentosRendererLogLevel;
  area: string;
  message: string;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: JsonObject;
}): void {
  const payload: ParentosRendererLogPayload = {
    level: input.level || 'info',
    area: String(input.area || 'renderer').trim() || 'renderer',
    message: String(input.message || 'action:parentos-log').trim() || 'action:parentos-log',
    traceId: String(input.traceId || '').trim() || undefined,
    flowId: String(input.flowId || '').trim() || undefined,
    source: String(input.source || '').trim() || undefined,
    costMs: typeof input.costMs === 'number' ? input.costMs : undefined,
    details: sanitizeDetails(input.details),
  };

  const prefix = `[parentos:${payload.area}] ${payload.message}`;
  consoleMethod(payload.level)(prefix, payload.details);

  if (!hasTauriRuntime()) {
    return;
  }

  void invokeTauri('log_renderer_event', { payload }).catch((error: unknown) => {
    consoleMethod('warn')('[parentos:renderer-log] action:tauri-log-forward-failed', describeError(error));
  });
}

export function installParentosGlobalErrorLogging(): void {
  if (globalErrorLoggingInstalled || typeof window === 'undefined') {
    return;
  }
  globalErrorLoggingInstalled = true;

  window.addEventListener('error', (event) => {
    logRendererEvent({
      level: 'error',
      area: 'window.error',
      message: 'action:window-error',
      details: {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: describeError(event.error),
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logRendererEvent({
      level: 'error',
      area: 'window.unhandledrejection',
      message: 'action:unhandled-rejection',
      details: {
        reason: describeError(event.reason),
      },
    });
  });
}
