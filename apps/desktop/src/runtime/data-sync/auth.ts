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
  emitRuntimeLog({
    level: options.level,
    area: 'datasync-auth',
    message: options.message,
    flowId: options.traceId,
    source: options.source,
    costMs: options.costMs,
    details: options.details,
  });
}
