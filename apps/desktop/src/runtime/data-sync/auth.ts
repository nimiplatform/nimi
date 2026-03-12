import { emitRuntimeLog, type RuntimeLogMessage } from '@runtime/telemetry/logger';

export type PasswordAuthDebug = {
  flowId?: string;
  traceId?: string;
  source?: string;
  startedAt?: number;
};

export type AuthLogOptions = {
  traceId?: string;
  source?: string;
  message: RuntimeLogMessage;
  level: 'debug' | 'info' | 'warn' | 'error';
  details?: Record<string, unknown>;
  costMs?: number;
};

export function traceIdOf(debug?: PasswordAuthDebug): string | undefined {
  return debug?.traceId || debug?.flowId;
}

export function emitAuthLog(options: AuthLogOptions): void {
  const flowId = typeof options.details?.flowId === 'string' && options.details.flowId.trim()
    ? options.details.flowId.trim()
    : options.traceId;
  emitRuntimeLog({
    level: options.level,
    area: 'datasync-auth',
    message: options.message,
    traceId: options.traceId,
    flowId,
    source: options.source,
    costMs: options.costMs,
    details: options.details,
  });
}
