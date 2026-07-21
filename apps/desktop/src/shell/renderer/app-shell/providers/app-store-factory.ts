import { createStore, type StoreApi } from 'zustand/vanilla';

import { createAuthSlice } from './auth-slice.js';
import {
  createRuntimeSlice,
  type RuntimeSliceDependencies,
} from './runtime-slice.js';
import type { AppStoreState } from './store-types.js';
import {
  createUiSlice,
  type UiSliceDependencies,
} from './ui-slice.js';

export type AppStoreDependencies = RuntimeSliceDependencies & UiSliceDependencies;
export type AppStoreApi = StoreApi<AppStoreState>;

export function createAppStore(dependencies: AppStoreDependencies): AppStoreApi {
  return createStore<AppStoreState>((set) => ({
    ...createAuthSlice(set),
    ...createRuntimeSlice(set, dependencies),
    ...createUiSlice(set, dependencies),
  }));
}
