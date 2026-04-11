import { create } from 'zustand';
import type { RuntimeDefaults } from '@renderer/bridge';
import type { ForgeWorldAccessRecord } from '@renderer/data/world-data-client.js';

export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

export type CreatorAccessState = {
  checked: boolean;
  hasAccess: boolean;
  canCreateWorld: boolean;
  canMaintainWorld: boolean;
  records: ForgeWorldAccessRecord[];
};

const EMPTY_CREATOR_ACCESS: CreatorAccessState = {
  checked: false,
  hasAccess: false,
  canCreateWorld: false,
  canMaintainWorld: false,
  records: [],
};

export interface ForgeAppStore {
  auth: {
    status: AuthStatus;
    user: AuthUser | null;
    token: string;
    refreshToken: string;
  };
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;
  creatorAccess: CreatorAccessState;
  sidebarCollapsed: boolean;

  setAuthSession(user: AuthUser, token: string, refreshToken: string): void;
  clearAuthSession(): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setRuntimeDefaults(defaults: RuntimeDefaults): void;
  setCreatorAccess(access: {
    hasAccess: boolean;
    canCreateWorld: boolean;
    canMaintainWorld: boolean;
    records: ForgeWorldAccessRecord[];
  }): void;
  toggleSidebar(): void;
}

export const useAppStore = create<ForgeAppStore>((set) => ({
  auth: {
    status: 'bootstrapping',
    user: null,
    token: '',
    refreshToken: '',
  },
  bootstrapReady: false,
  bootstrapError: null,
  runtimeDefaults: null,
  creatorAccess: { ...EMPTY_CREATOR_ACCESS },
  sidebarCollapsed: false,

  setAuthSession(user, token, refreshToken) {
    set({
      auth: { status: 'authenticated', user, token, refreshToken },
      creatorAccess: { ...EMPTY_CREATOR_ACCESS },
    });
  },

  clearAuthSession() {
    set({
      auth: { status: 'unauthenticated', user: null, token: '', refreshToken: '' },
      creatorAccess: { ...EMPTY_CREATOR_ACCESS },
    });
  },

  setBootstrapReady(ready) {
    set({ bootstrapReady: ready });
  },

  setBootstrapError(error) {
    set({ bootstrapError: error });
  },

  setRuntimeDefaults(defaults) {
    set({ runtimeDefaults: defaults });
  },

  setCreatorAccess(access) {
    set({
      creatorAccess: {
        checked: true,
        hasAccess: access.hasAccess,
        canCreateWorld: access.canCreateWorld,
        canMaintainWorld: access.canMaintainWorld,
        records: access.records,
      },
    });
  },

  toggleSidebar() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },
}));
