import { createModSdkRendererFlowId, emitModSdkRendererEvent, emitModSdkRuntimeLog, } from './internal/logging-access';
export function emitRuntimeLog(payload) {
    emitModSdkRuntimeLog(payload);
}
export function createRendererFlowId(prefix) {
    return createModSdkRendererFlowId(prefix);
}
export function logRendererEvent(payload) {
    emitModSdkRendererEvent(payload);
}
