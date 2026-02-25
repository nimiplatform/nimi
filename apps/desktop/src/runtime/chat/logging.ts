import { emitRuntimeLog, type RuntimeLogMessage } from '@runtime/telemetry/logger';

export function createChatRouteFlowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emitChatRouteLog(options: {
  level?: 'debug' | 'info' | 'warn' | 'error';
  message: RuntimeLogMessage;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
}): void {
  const { level = 'info', message, flowId, source, costMs, details } = options;
  emitRuntimeLog({
    level,
    area: 'chat-route',
    message,
    flowId,
    source,
    costMs,
    details,
  });
}
