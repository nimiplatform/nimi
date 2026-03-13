// RL-CORE-001 — Selected Agent Drives All Surfaces
// RL-CORE-002 — Agent Binding Propagation
// RL-BOOT-004 — Runtime Unavailable Degradation

import { create } from 'zustand';

export interface Agent {
  id: string;
  name: string;
  avatarUrl?: string;
  description?: string;
  voiceModel?: string;
  voiceId?: string;
  live2dModelUrl?: string;
}

export interface AppState {
  /** RL-CORE-001: The single global agent context */
  currentAgent: Agent | null;
  /** RL-BOOT-004: Runtime availability flag */
  runtimeAvailable: boolean;
  /** Socket.io connection status */
  realtimeConnected: boolean;

  /** RL-CORE-002: Set agent — resets all active sessions */
  setAgent: (agent: Agent | null) => void;
  setRuntimeAvailable: (available: boolean) => void;
  setRealtimeConnected: (connected: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentAgent: null,
  runtimeAvailable: false,
  realtimeConnected: false,

  setAgent: (agent) => set({
    currentAgent: agent,
    // RL-CORE-002: changing agent resets active sessions
    // Feature hooks observe currentAgent and reset their state when it changes
  }),

  setRuntimeAvailable: (available) => set({ runtimeAvailable: available }),
  setRealtimeConnected: (connected) => set({ realtimeConnected: connected }),
}));
