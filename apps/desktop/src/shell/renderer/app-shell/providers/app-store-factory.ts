import { createStore, type StoreApi } from 'zustand/vanilla';

import { createAuthSlice } from './auth-slice.js';
import { createRuntimeSlice } from './runtime-slice.js';
import type { AppStoreState } from './store-types.js';
import {
  createUiSlice,
  type UiSliceDependencies,
} from './ui-slice.js';

export type AppStoreDependencies = UiSliceDependencies;
export type AppStoreApi = StoreApi<AppStoreState>;

export function createAppStore(dependencies: AppStoreDependencies): AppStoreApi {
  return createStore<AppStoreState>((set) => ({
    ...createAuthSlice(set),
    ...createRuntimeSlice(set),
    ...createUiSlice(set, dependencies),
  }));
}
