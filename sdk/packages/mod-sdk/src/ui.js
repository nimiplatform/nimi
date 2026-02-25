import { createElement } from 'react';
import { getModSdkSlotHost, useModSdkAppStore, useModSdkUiExtensionContext, } from './internal/ui-access';
export function useAppStore(selector) {
    return useModSdkAppStore(selector);
}
export function useUiExtensionContext() {
    return useModSdkUiExtensionContext();
}
export function SlotHost(props) {
    return createElement(getModSdkSlotHost(), props);
}
