import { create } from 'zustand';
import type { RuntimeDefaults } from '@renderer/bridge/types.js';

export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

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
  creatorAccess: {
    checked: boolean;
    hasAccess: boolean;
  };
  sidebarCollapsed: boolean;

  setAuthSession(user: AuthUser, token: string, refreshToken: string): void;
  clearAuthSession(): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setRuntimeDefaults(defaults: RuntimeDefaults): void;
  setCreatorAccess(hasAccess: boolean): void;
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
  creatorAccess: {
    checked: false,
    hasAccess: false,
  },
  sidebarCollapsed: false,

  setAuthSession(user, token, refreshToken) {
    set({
      auth: { status: 'authenticated', user, token, refreshToken },
      creatorAccess: { checked: false, hasAccess: false },
    });
  },

  clearAuthSession() {
    set({
      auth: { status: 'unauthenticated', user: null, token: '', refreshToken: '' },
      creatorAccess: { checked: false, hasAccess: false },
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

  setCreatorAccess(hasAccess) {
    set({ creatorAccess: { checked: true, hasAccess } });
  },

  toggleSidebar() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },
}));
