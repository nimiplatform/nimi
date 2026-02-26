import { getModSdkHost } from '../host';
import type { RendererLogMessage, RuntimeLogMessage } from './host-types';

export function emitModSdkRuntimeLog(payload: RuntimeLogMessage): void {
  getModSdkHost().logging.emitRuntimeLog(payload);
}

export function createModSdkRendererFlowId(prefix: string): string {
  return getModSdkHost().logging.createRendererFlowId(prefix);
}

export function emitModSdkRendererEvent(payload: RendererLogMessage): void {
  getModSdkHost().logging.logRendererEvent(payload);
}
