import { getModSdkHost } from '../host';
export function useModSdkAppStore(selector) {
    return getModSdkHost().ui.useAppStore(selector);
}
export function useModSdkUiExtensionContext() {
    return getModSdkHost().ui.useUiExtensionContext();
}
export function getModSdkSlotHost() {
    return getModSdkHost().ui.SlotHost;
}
