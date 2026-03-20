import { getModSdkHost } from '../host.js';
import type { ModSdkUiContext } from './host-types.js';

export function useModSdkAppStore<T>(selector: (state: unknown) => T): T {
  return getModSdkHost().ui.useAppStore(selector);
}

export function useModSdkUiExtensionContext(): ModSdkUiContext {
  return getModSdkHost().ui.useUiExtensionContext();
}

export function getModSdkSlotHost() {
  return getModSdkHost().ui.SlotHost;
}
