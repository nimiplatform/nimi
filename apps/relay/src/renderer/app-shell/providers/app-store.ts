// RL-CORE-001 — Selected Agent Drives All Surfaces
// RL-CORE-002 — Agent Binding Propagation
// RL-BOOT-004 — Runtime Unavailable Degradation

import { create } from 'zustand';

export interface Agent {
  id: string;
  name: string;
  handle?: string;
  state?: string;
  avatarUrl?: string;
  description?: string;
  voiceModel?: string;
  voiceId?: string;
  live2dModelUrl?: string;
}

export type AuthState = 'pending' | 'authenticating' | 'authenticated' | 'failed';

export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
  handle?: string;
}

export type DetailMode = 'none' | 'settings';

export interface AppState {
  /** RL-CORE-001: The single global agent context */
  currentAgent: Agent | null;
  /** RL-BOOT-004: Runtime availability flag */
  runtimeAvailable: boolean;
  /** Socket.io connection status */
  realtimeConnected: boolean;
  /** RL-BOOT-005: Auth state */
  authState: AuthState;
  /** Auth error message when authState === 'failed' */
  authError: string | null;
  /** Current authenticated user profile */
  currentUser: UserProfile | null;
  /** Right panel state */
  detailMode: DetailMode;

  /** RL-CORE-002: Set agent — resets all active sessions */
  setAgent: (agent: Agent | null) => void;
  setRuntimeAvailable: (available: boolean) => void;
  setRealtimeConnected: (connected: boolean) => void;
  setAuthState: (state: AuthState, error?: string | null) => void;
  setCurrentUser: (user: UserProfile | null) => void;
  setDetailMode: (mode: DetailMode) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentAgent: null,
  runtimeAvailable: false,
  realtimeConnected: false,
  authState: 'pending',
  authError: null,
  currentUser: null,
  detailMode: 'none',

  setAgent: (agent) => set({
    currentAgent: agent,
    // RL-CORE-002: changing agent resets active sessions
    // Feature hooks observe currentAgent and reset their state when it changes
  }),

  setRuntimeAvailable: (available) => set({ runtimeAvailable: available }),
  setRealtimeConnected: (connected) => set({ realtimeConnected: connected }),
  setAuthState: (state, error) => set({ authState: state, authError: error ?? null }),
  setCurrentUser: (user) => set({ currentUser: user }),
  setDetailMode: (mode) => set({ detailMode: mode }),
}));
