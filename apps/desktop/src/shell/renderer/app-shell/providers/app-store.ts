import { create } from 'zustand';
import { createAuthSlice } from './store-slices/auth-slice';
import { createRuntimeSlice } from './store-slices/runtime-slice';
import { createModWorkspaceSlice } from './store-slices/mod-workspace-slice';
import { createUiSlice } from './store-slices/ui-slice';
import type { AppStoreState } from './store-types';

export type {
  AppStoreState,
  AppTab,
  AuthStatus,
  ModWorkspaceTab,
  RuntimeFieldMap,
  StatusBanner,
  StatusKind,
} from './store-types';

export const useAppStore = create<AppStoreState>((set) => ({
  ...createAuthSlice(set),
  ...createRuntimeSlice(set),
  ...createModWorkspaceSlice(set),
  ...createUiSlice(set),
}));
