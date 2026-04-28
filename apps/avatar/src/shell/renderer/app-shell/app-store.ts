import { create } from 'zustand';
import type { RuntimeDefaults } from '../bridge/index.js';
import type { AvatarLaunchContext } from '../bridge/index.js';
import type { AgentDataBundle, DriverStatus } from '../driver/types.js';

export type ShellVisibility = 'on_screen' | 'off_screen' | 'tray_minimized';
export type ModelLoadState = 'idle' | 'loading' | 'loaded' | 'error';
export type DriverMode = 'sdk' | 'mock';
export type DriverAuthority = 'runtime' | 'fixture';

export type AvatarAppState = {
  shell: {
    shellReady: boolean;
    windowSize: { width: number; height: number };
    alwaysOnTop: boolean;
    visibility: ShellVisibility;
  };
  model: {
    modelPath: string | null;
    modelId: string | null;
    loadState: ModelLoadState;
    error: string | null;
  };
  consume: {
    mode: DriverMode | null;
    authority: DriverAuthority | null;
    fixtureId: string | null;
    fixturePlaying: boolean;
    avatarInstanceId: string | null;
    conversationAnchorId: string | null;
    agentId: string | null;
    worldId: string | null;
  };
  launch: {
    context: AvatarLaunchContext | null;
  };
  runtime: {
    defaults: RuntimeDefaults | null;
  };
  driver: {
    status: DriverStatus;
  };
  bundle: AgentDataBundle | null;
  markShellReady(size: { width: number; height: number }): void;
  setWindowSize(size: { width: number; height: number }): void;
  setAlwaysOnTop(value: boolean): void;
  setVisibility(value: ShellVisibility): void;
  setModelPath(path: string): void;
  setModelLoading(): void;
  setModelLoaded(modelId: string): void;
  setModelError(message: string): void;
  setConsumeMode(input: {
    mode: DriverMode;
    authority: DriverAuthority;
    fixtureId?: string | null;
    fixturePlaying?: boolean;
  }): void;
  setRuntimeBinding(input: {
    avatarInstanceId: string;
    conversationAnchorId: string;
    agentId: string;
    worldId: string;
  }): void;
  clearRuntimeBinding(): void;
  setLaunchContext(context: AvatarLaunchContext): void;
  setRuntimeDefaults(defaults: RuntimeDefaults): void;
  setDriverStatus(status: DriverStatus): void;
  setBundle(bundle: AgentDataBundle): void;
  clearBundle(): void;
};

export const useAvatarStore = create<AvatarAppState>((set) => ({
  shell: {
    shellReady: false,
    windowSize: { width: 400, height: 600 },
    alwaysOnTop: true,
    visibility: 'on_screen',
  },
  model: {
    modelPath: null,
    modelId: null,
    loadState: 'idle',
    error: null,
  },
  consume: {
    mode: null,
    authority: null,
    fixtureId: null,
    fixturePlaying: false,
    avatarInstanceId: null,
    conversationAnchorId: null,
    agentId: null,
    worldId: null,
  },
  launch: {
    context: null,
  },
  runtime: {
    defaults: null,
  },
  driver: {
    status: 'idle',
  },
  bundle: null,

  markShellReady(size) {
    set((state) => ({ shell: { ...state.shell, shellReady: true, windowSize: size } }));
  },
  setWindowSize(size) {
    set((state) => ({ shell: { ...state.shell, windowSize: size } }));
  },
  setAlwaysOnTop(value) {
    set((state) => ({ shell: { ...state.shell, alwaysOnTop: value } }));
  },
  setVisibility(value) {
    set((state) => ({ shell: { ...state.shell, visibility: value } }));
  },
  setModelPath(path) {
    set((state) => ({ model: { ...state.model, modelPath: path } }));
  },
  setModelLoading() {
    set((state) => ({ model: { ...state.model, loadState: 'loading', error: null } }));
  },
  setModelLoaded(modelId) {
    set((state) => ({ model: { ...state.model, modelId, loadState: 'loaded', error: null } }));
  },
  setModelError(message) {
    set((state) => ({ model: { ...state.model, loadState: 'error', error: message } }));
  },
  setConsumeMode(input) {
    set((state) => ({
      consume: {
        ...state.consume,
        mode: input.mode,
        authority: input.authority,
        fixtureId: input.fixtureId ?? null,
        fixturePlaying: input.fixturePlaying ?? false,
      },
    }));
  },
  setRuntimeBinding(input) {
    set((state) => ({
      consume: {
        ...state.consume,
        avatarInstanceId: input.avatarInstanceId,
        conversationAnchorId: input.conversationAnchorId,
        agentId: input.agentId,
        worldId: input.worldId,
      },
    }));
  },
  clearRuntimeBinding() {
    set((state) => ({
      consume: {
        ...state.consume,
        avatarInstanceId: null,
        conversationAnchorId: null,
        agentId: null,
        worldId: null,
      },
    }));
  },
  setLaunchContext(context) {
    set({
      launch: {
        context,
      },
    });
  },
  setRuntimeDefaults(defaults) {
    set({ runtime: { defaults } });
  },
  setDriverStatus(status) {
    set({ driver: { status } });
  },
  setBundle(bundle) {
    set({ bundle });
  },
  clearBundle() {
    set({ bundle: null });
  },
}));
