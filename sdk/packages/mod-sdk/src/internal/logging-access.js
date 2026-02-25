import { getModSdkHost } from '../host';
export function emitModSdkRuntimeLog(payload) {
    getModSdkHost().logging.emitRuntimeLog(payload);
}
export function createModSdkRendererFlowId(prefix) {
    return getModSdkHost().logging.createRendererFlowId(prefix);
}
export function emitModSdkRendererEvent(payload) {
    getModSdkHost().logging.logRendererEvent(payload);
}
