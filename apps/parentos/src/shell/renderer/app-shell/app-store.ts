import { create } from 'zustand';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import type { ParentOSRuntimeDefaults as RuntimeDefaults } from '../bridge/index.js';

export type NurtureMode = 'relaxed' | 'balanced' | 'advanced';

export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

export interface ChildProfile {
  childId: string;
  familyId: string;
  displayName: string;
  gender: 'male' | 'female';
  birthDate: string;
  birthWeightKg: number | null;
  birthHeightCm: number | null;
  birthHeadCircCm: number | null;
  avatarPath: string | null;
  nurtureMode: NurtureMode;
  nurtureModeOverrides: Record<string, NurtureMode> | null;
  allergies: string[] | null;
  medicalNotes: string[] | null;
  recorderProfiles: Array<{ id: string; name: string }> | null;
  createdAt: string;
  updatedAt: string;
}

interface AppState {
  // PO-SHELL-008 / spec K-ACCSVC-008: ParentOS does not own access or refresh
  // tokens. The `auth` slice tracks only the runtime-projected account
  // identity. Short-lived access tokens, when needed for a direct realm call,
  // are pulled from `runtime.account.getAccessToken` at call time and never
  // persisted in this store.
  auth: {
    status: AuthStatus;
    user: AuthUser | null;
  };
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;

  setAuthSession: (user: AuthUser) => void;
  clearAuthSession: () => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (error: string | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  clearLocalData: () => void;

  activeChildId: string | null;
  setActiveChildId: (id: string | null) => void;

  children: ChildProfile[];
  setChildren: (children: ChildProfile[]) => void;

  familyId: string | null;
  setFamilyId: (id: string | null) => void;

  aiConfig: AIConfig | null;
  setAIConfig: (config: AIConfig) => void;
}

export const useAppStore = create<AppState>((set) => ({
  auth: {
    status: 'bootstrapping',
    user: null,
  },
  bootstrapReady: false,
  bootstrapError: null,
  runtimeDefaults: null,

  setAuthSession(user) {
    set({
      auth: { status: 'authenticated', user },
    });
  },
  clearAuthSession() {
    set({
      auth: { status: 'unauthenticated', user: null },
      familyId: null,
      children: [],
      activeChildId: null,
      aiConfig: null,
    });
  },
  setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
  setBootstrapError: (error) => set({ bootstrapError: error }),
  setRuntimeDefaults: (defaults) => set({ runtimeDefaults: defaults }),
  clearLocalData: () => set({
    familyId: null,
    children: [],
    activeChildId: null,
    aiConfig: null,
  }),

  activeChildId: null,
  setActiveChildId: (id) => set({ activeChildId: id }),

  children: [],
  setChildren: (children) => set({ children }),

  familyId: null,
  setFamilyId: (id) => set({ familyId: id }),

  aiConfig: null,
  setAIConfig: (config) => set({ aiConfig: config }),
}));

/** Compute age in months from birth date to now */
export function computeAgeMonths(birthDate: string): number {
  return computeAgeMonthsAt(birthDate, new Date().toISOString());
}

/** Compute age in months from birth date to an arbitrary ISO date/datetime */
export function computeAgeMonthsAt(birthDate: string, atDate: string): number {
  const birth = new Date(birthDate);
  const target = new Date(atDate);
  let months = (target.getFullYear() - birth.getFullYear()) * 12 + (target.getMonth() - birth.getMonth());
  if (target.getDate() < birth.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

/**
 * Format age in months for display:
 *   < 12 months → "X 个月"
 *   >= 12 months → "X岁Y个月" (omit Y if 0)
 */
export function formatAge(months: number): string {
  if (months < 12) return `${months}个月`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m > 0 ? `${y}岁${m}个月` : `${y}岁`;
}
