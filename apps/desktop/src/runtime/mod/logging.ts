import { emitRuntimeLog, type RuntimeLogMessage } from '@runtime/telemetry/logger';

export type RuntimeModRuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export function createRuntimeModFlowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emitRuntimeModRuntimeLog(options: {
  level?: RuntimeModRuntimeLogLevel;
  message: RuntimeLogMessage;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
}): void {
  const { level = 'info', message, flowId, source, costMs, details } = options;
  emitRuntimeLog({
    level,
    area: 'runtime-mod-runtime',
    message,
    flowId,
    source,
    costMs,
    details,
  });
}
