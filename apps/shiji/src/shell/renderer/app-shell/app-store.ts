import { create } from 'zustand';
import type { RuntimeDefaults } from '@renderer/bridge/types.js';

// ── Auth ─────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

export interface AuthSlice {
  auth: {
    status: AuthStatus;
    user: AuthUser | null;
    token: string;
    refreshToken: string;
  };
  setAuthSession(user: AuthUser, token: string, refreshToken: string): void;
  clearAuthSession(): void;
}

// ── Bootstrap ────────────────────────────────────────────────────────────

export interface BootstrapSlice {
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setRuntimeDefaults(defaults: RuntimeDefaults): void;
}

// ── Profile ──────────────────────────────────────────────────────────────

export type LearnerProfile = {
  id: string;
  authUserId: string;
  displayName: string;
  age: number;
  communicationStyle: string;
  guardianGoals: string;
  profileVersion: number;
  isActive: boolean;
  encounterCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  strengthTags: string[];
  interestTags: string[];
  supportNotes: string[];
  guardianGuidance: Record<string, string>;
};

export interface ProfileSlice {
  activeProfile: LearnerProfile | null;
  profiles: LearnerProfile[];
  profilesLoaded: boolean;
  setActiveProfile(profile: LearnerProfile | null): void;
  setProfiles(profiles: LearnerProfile[]): void;
  setProfilesLoaded(loaded: boolean): void;
  updateProfileEncounterCompleted(profileId: string, completedAt: string): void;
}

// ── Session ──────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export interface SessionSlice {
  activeSessionId: string | null;
  sessionMode: 'normal' | 'fullscreen';
  setActiveSessionId(id: string | null): void;
  setSessionMode(mode: 'normal' | 'fullscreen'): void;
}

// ── UI ───────────────────────────────────────────────────────────────────

export interface UiSlice {
  sidebarCollapsed: boolean;
  sessionTimerMinutes: number | null; // null = off; SJ-SHELL-005:4
  toggleSidebar(): void;
  setSessionTimerMinutes(minutes: number | null): void;
}

// ── Settings ─────────────────────────────────────────────────────────────

export interface SettingsSlice {
  aiModel: string;
  setAiModel(model: string): void;
}

// ── Combined Store ───────────────────────────────────────────────────────

export type ShiJiStore = AuthSlice & BootstrapSlice & ProfileSlice & SessionSlice & UiSlice & SettingsSlice;

export const useAppStore = create<ShiJiStore>((set) => ({
  // Auth
  auth: {
    status: 'bootstrapping',
    user: null,
    token: '',
    refreshToken: '',
  },
  setAuthSession(user, token, refreshToken) {
    set({ auth: { status: 'authenticated', user, token, refreshToken } });
  },
  clearAuthSession() {
    set({ auth: { status: 'unauthenticated', user: null, token: '', refreshToken: '' } });
  },

  // Bootstrap
  bootstrapReady: false,
  bootstrapError: null,
  runtimeDefaults: null,
  setBootstrapReady(ready) {
    set({ bootstrapReady: ready });
  },
  setBootstrapError(error) {
    set({ bootstrapError: error });
  },
  setRuntimeDefaults(defaults) {
    set({ runtimeDefaults: defaults });
  },

  // Profile
  activeProfile: null,
  profiles: [],
  profilesLoaded: false,
  setActiveProfile(profile) {
    set({ activeProfile: profile });
  },
  setProfiles(profiles) {
    set({ profiles });
  },
  setProfilesLoaded(loaded) {
    set({ profilesLoaded: loaded });
  },
  updateProfileEncounterCompleted(profileId, completedAt) {
    set((state) => ({
      profiles: state.profiles.map((p) =>
        p.id === profileId ? { ...p, encounterCompletedAt: completedAt } : p
      ),
      activeProfile:
        state.activeProfile?.id === profileId
          ? { ...state.activeProfile, encounterCompletedAt: completedAt }
          : state.activeProfile,
    }));
  },

  // Session
  activeSessionId: null,
  sessionMode: 'normal',
  setActiveSessionId(id) {
    set({ activeSessionId: id });
  },
  setSessionMode(mode) {
    set({ sessionMode: mode });
  },

  // UI
  sidebarCollapsed: false,
  sessionTimerMinutes: 45, // SJ-SHELL-004:3 — default 45 minutes
  toggleSidebar() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },
  setSessionTimerMinutes(minutes) {
    set({ sessionTimerMinutes: minutes });
  },

  // Settings
  aiModel: '',
  setAiModel(model) {
    set({ aiModel: model });
  },
}));
