import {
  createContext,
  createElement,
  useContext,
  type PropsWithChildren,
} from 'react';
import { useStore } from 'zustand';

import type { AppStoreApi } from './app-store-factory.js';
import type { AppStoreState } from './store-types.js';

export type {
  AppStoreState,
  AppTab,
  AuthStatus,
  RuntimeAccountAuthProjection,
  RuntimeFieldMap,
  StatusBanner,
  StatusKind,
} from './store-types.js';

const AppStoreContext = createContext<AppStoreApi | null>(null);

export function AppStoreProvider(props: PropsWithChildren<{
  readonly store: AppStoreApi;
}>) {
  return createElement(
    AppStoreContext.Provider,
    { value: props.store },
    props.children,
  );
}

export function useAppStoreApi(): AppStoreApi {
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new Error('DESKTOP_RENDERER_APP_STORE_MISSING');
  }
  return store;
}

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  return useStore(useAppStoreApi(), selector);
}
