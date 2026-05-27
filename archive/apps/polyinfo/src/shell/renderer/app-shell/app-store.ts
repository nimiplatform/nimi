import { create } from 'zustand';
import { createAuthSlice } from './auth-slice.js';
import { createPolyinfoDataSlice } from './polyinfo-data-slice.js';
import { createRuntimeSlice } from './runtime-slice.js';
import { createUiSlice } from './ui-slice.js';
import type { AppStoreState } from './store-types.js';

export type { AppStoreState, AuthStatus } from './store-types.js';

export const useAppStore = create<AppStoreState>((set, get) => ({
  ...createAuthSlice(set),
  ...createUiSlice(set),
  ...createRuntimeSlice(set),
  ...createPolyinfoDataSlice(set, get),
}));
