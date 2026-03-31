import { create } from 'zustand';
import type { RuntimeDefaults } from '@renderer/bridge/types.js';
import type { MomentRuntimeTargetOption } from '@renderer/features/moment/runtime-targets.js';

export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';
export type RuntimeStatus = 'checking' | 'ready' | 'degraded' | 'unavailable';

export type RuntimeProbeState = {
  realmConfigured: boolean;
  realmAuthenticated: boolean;
  textDefaultTargetKey?: string;
  textConnectorId?: string;
  textModelId?: string;
  visionDefaultTargetKey?: string;
  visionConnectorId?: string;
  visionModelId?: string;
  textTargets: MomentRuntimeTargetOption[];
  visionTargets: MomentRuntimeTargetOption[];
  issues: string[];
};

type RuntimePreferences = {
  textTargetKey?: string;
  visionTargetKey?: string;
};

export interface MomentAppStore {
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
  preferences: RuntimePreferences;
  routeSettingsOpen: boolean;

  setAuthSession(user: AuthUser, token: string, refreshToken: string): void;
  clearAuthSession(): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setRuntimeDefaults(defaults: RuntimeDefaults): void;
  setRuntimeStatus(status: RuntimeStatus, error?: string): void;
  setRuntimeProbe(input: RuntimeProbeState): void;
  setTextTargetKey(targetKey?: string): void;
  setVisionTargetKey(targetKey?: string): void;
  setRouteSettingsOpen(open: boolean): void;
}

const MOMENT_PREFS_STORAGE_KEY = 'moment.runtime.preferences';

const DEFAULT_RUNTIME_PROBE: RuntimeProbeState = {
  realmConfigured: false,
  realmAuthenticated: false,
  textDefaultTargetKey: undefined,
  textConnectorId: undefined,
  textModelId: undefined,
  visionDefaultTargetKey: undefined,
  visionConnectorId: undefined,
  visionModelId: undefined,
  textTargets: [],
  visionTargets: [],
  issues: [],
};

function loadPreferences(): RuntimePreferences {
  try {
    const raw = localStorage.getItem(MOMENT_PREFS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as RuntimePreferences;
    return {
      textTargetKey: parsed.textTargetKey ? String(parsed.textTargetKey) : undefined,
      visionTargetKey: parsed.visionTargetKey ? String(parsed.visionTargetKey) : undefined,
    };
  } catch {
    return {};
  }
}

function savePreferences(preferences: RuntimePreferences): void {
  try {
    localStorage.setItem(MOMENT_PREFS_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // no-op
  }
}

export const useAppStore = create<MomentAppStore>((set, get) => ({
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
  preferences: loadPreferences(),
  routeSettingsOpen: false,

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
    const nextPreferences = { ...get().preferences };
    if (!nextPreferences.textTargetKey && input.textDefaultTargetKey) {
      nextPreferences.textTargetKey = input.textDefaultTargetKey;
    }
    if (!nextPreferences.visionTargetKey && input.visionDefaultTargetKey) {
      nextPreferences.visionTargetKey = input.visionDefaultTargetKey;
    }
    savePreferences(nextPreferences);
    set({ runtimeProbe: input, preferences: nextPreferences });
  },

  setTextTargetKey(targetKey) {
    const preferences = { ...get().preferences, textTargetKey: targetKey || undefined };
    savePreferences(preferences);
    set({ preferences });
  },

  setVisionTargetKey(targetKey) {
    const preferences = { ...get().preferences, visionTargetKey: targetKey || undefined };
    savePreferences(preferences);
    set({ preferences });
  },

  setRouteSettingsOpen(open) {
    set({ routeSettingsOpen: open });
  },
}));
