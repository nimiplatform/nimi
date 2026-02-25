import { logRendererEvent as logBridgeRendererEvent, toRendererLogMessage } from '@renderer/bridge/runtime-bridge/logging';
import type { RendererLogMessage } from '@renderer/bridge/runtime-bridge/types';

type RendererLogLevel = 'debug' | 'info' | 'warn' | 'error';

export function createRendererFlowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function logRendererEvent(payload: {
  level?: RendererLogLevel;
  area: string;
  message: RendererLogMessage | string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
}): void {
  logBridgeRendererEvent({
    level: payload.level || 'info',
    area: payload.area,
    message: toRendererLogMessage(payload.message),
    flowId: payload.flowId,
    source: payload.source,
    costMs: payload.costMs,
    details: payload.details,
  });
}
