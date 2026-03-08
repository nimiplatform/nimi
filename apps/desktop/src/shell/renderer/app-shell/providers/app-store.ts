import { create } from 'zustand';
import { createAuthSlice } from './auth-slice';
import { createRuntimeSlice } from './runtime-slice';
import { createModWorkspaceSlice } from './mod-workspace-slice';
import { createUiSlice } from './ui-slice';
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
