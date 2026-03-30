import { create } from 'zustand';
import type { RuntimeDefaults } from '@renderer/bridge/types.js';
import type { LookdevRuntimeTargetOption } from '@renderer/features/lookdev/lookdev-route.js';

export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';
export type RuntimeStatus = 'checking' | 'ready' | 'degraded' | 'unavailable';

export type RuntimeTargetOption = LookdevRuntimeTargetOption;

export type RuntimeProbeState = {
  realmConfigured: boolean;
  realmAuthenticated: boolean;
  textDefaultTargetKey?: string;
  textConnectorId?: string;
  textModelId?: string;
  imageDefaultTargetKey?: string;
  imageConnectorId?: string;
  imageModelId?: string;
  visionDefaultTargetKey?: string;
  visionConnectorId?: string;
  visionModelId?: string;
  textTargets: RuntimeTargetOption[];
  imageTargets: RuntimeTargetOption[];
  visionTargets: RuntimeTargetOption[];
  issues: string[];
};

export interface LookdevAppStore {
  auth: {
    status: AuthStatus;
    user: AuthUser | null;
    token: string;
    refreshToken: string;
  };
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;
  runtimeStatus: RuntimeStatus;
  runtimeError: string | null;
  runtimeProbe: RuntimeProbeState;

  setAuthSession(user: AuthUser, token: string, refreshToken: string): void;
  clearAuthSession(): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setRuntimeDefaults(defaults: RuntimeDefaults): void;
  setRuntimeStatus(status: RuntimeStatus, error?: string): void;
  setRuntimeProbe(input: RuntimeProbeState): void;
}

const DEFAULT_RUNTIME_PROBE: RuntimeProbeState = {
  realmConfigured: false,
  realmAuthenticated: false,
  textDefaultTargetKey: undefined,
  textConnectorId: undefined,
  textModelId: undefined,
  imageDefaultTargetKey: undefined,
  imageConnectorId: undefined,
  imageModelId: undefined,
  visionDefaultTargetKey: undefined,
  visionConnectorId: undefined,
  visionModelId: undefined,
  textTargets: [],
  imageTargets: [],
  visionTargets: [],
  issues: [],
};

export const useAppStore = create<LookdevAppStore>((set) => ({
  auth: {
    status: 'bootstrapping',
    user: null,
    token: '',
    refreshToken: '',
  },
  bootstrapReady: false,
  bootstrapError: null,
  runtimeDefaults: null,
  runtimeStatus: 'checking',
  runtimeError: null,
  runtimeProbe: DEFAULT_RUNTIME_PROBE,

  setAuthSession(user, token, refreshToken) {
    set({
      auth: { status: 'authenticated', user, token, refreshToken },
    });
  },

  clearAuthSession() {
    set({
      auth: { status: 'unauthenticated', user: null, token: '', refreshToken: '' },
      runtimeProbe: DEFAULT_RUNTIME_PROBE,
      runtimeError: null,
      runtimeStatus: 'checking',
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

  setRuntimeStatus(status, error) {
    set({ runtimeStatus: status, runtimeError: error ?? null });
  },

  setRuntimeProbe(input) {
    set({ runtimeProbe: input });
  },
}));
