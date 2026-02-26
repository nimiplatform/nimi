import { getModSdkHost } from '../host';
import type { ModSdkUiContext } from './host-types';

export function useModSdkAppStore<T>(selector: (state: unknown) => T): T {
  return getModSdkHost().ui.useAppStore(selector);
}

export function useModSdkUiExtensionContext(): ModSdkUiContext {
  return getModSdkHost().ui.useUiExtensionContext();
}

export function getModSdkSlotHost() {
  return getModSdkHost().ui.SlotHost;
}
