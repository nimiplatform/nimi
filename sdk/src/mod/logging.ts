import type { RendererLogMessage, RuntimeLogMessage } from './internal/host-types.js';
import { getModSdkHost } from './host.js';

export function emitRuntimeLog(payload: RuntimeLogMessage): void {
  getModSdkHost().logging.emitRuntimeLog(payload);
}

export function createRendererFlowId(prefix: string): string {
  return getModSdkHost().logging.createRendererFlowId(prefix);
}

export function logRendererEvent(payload: RendererLogMessage): void {
  getModSdkHost().logging.logRendererEvent(payload);
}
