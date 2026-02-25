export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type RuntimeLogMessage = `action:${string}` | `phase:${string}`;

export type RuntimeLogPayload = {
  level?: RuntimeLogLevel;
  area: string;
  message: RuntimeLogMessage | string;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
};

type RuntimeLogger = (payload: RuntimeLogPayload) => void;

let runtimeLogger: RuntimeLogger | null = null;

function fallbackConsoleLog(payload: RuntimeLogPayload): void {
  const level = payload.level || 'info';
  const prefix = `[runtime:${payload.area}] ${payload.message}`;
  if (level === 'error') {
    console.error(prefix, payload.details);
  } else if (level === 'warn') {
    console.warn(prefix, payload.details);
  } else if (level === 'debug') {
    console.debug(prefix, payload.details);
  } else {
    console.info(prefix, payload.details);
  }
}

function normalizeRuntimeLogMessage(message: unknown): RuntimeLogMessage {
  const normalized = String(message || '').trim();
  if (normalized.startsWith('action:') || normalized.startsWith('phase:')) {
    return normalized as RuntimeLogMessage;
  }
  if (!normalized) {
    return 'action:runtime-log:empty-message';
  }
  return `action:${normalized}` as RuntimeLogMessage;
}

export function setRuntimeLogger(logger: RuntimeLogger | null): void {
  runtimeLogger = logger;
}

export function emitRuntimeLog(payload: RuntimeLogPayload): void {
  const normalized: RuntimeLogPayload = {
    ...payload,
    area: String(payload.area || 'runtime'),
    message: normalizeRuntimeLogMessage(payload.message),
  };
  if (!runtimeLogger) {
    fallbackConsoleLog(normalized);
    return;
  }
  runtimeLogger(normalized);
}
