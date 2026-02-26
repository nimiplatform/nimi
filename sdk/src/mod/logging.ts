import type { RendererLogMessage, RuntimeLogMessage } from './internal/host-types';
import {
  createModSdkRendererFlowId,
  emitModSdkRendererEvent,
  emitModSdkRuntimeLog,
} from './internal/logging-access';

export function emitRuntimeLog(payload: RuntimeLogMessage): void {
  emitModSdkRuntimeLog(payload);
}

export function createRendererFlowId(prefix: string): string {
  return createModSdkRendererFlowId(prefix);
}

export function logRendererEvent(payload: RendererLogMessage): void {
  emitModSdkRendererEvent(payload);
}
