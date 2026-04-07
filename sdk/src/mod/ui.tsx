import * as React from 'react';
import type { ReactNode } from 'react';
import type { ModSdkUiContext } from './internal/host-types';
import {
  getModSdkSlotHost,
  useModSdkAppStore,
  useModSdkUiExtensionContext,
} from './internal/ui-access.js';

export function useAppStore<T>(selector: (state: unknown) => T): T {
  return useModSdkAppStore(selector);
}

export function useUiExtensionContext(): ModSdkUiContext {
  return useModSdkUiExtensionContext();
}

export function SlotHost(props: {
  slot: string;
  base: ReactNode;
  context: ModSdkUiContext;
}) {
  return React.createElement(getModSdkSlotHost(), props);
}
