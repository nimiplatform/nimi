import { create } from 'zustand';
import type { AgentDataBundle, DriverStatus } from '../driver/types.js';

export type ShellVisibility = 'on_screen' | 'off_screen' | 'tray_minimized';
export type ModelLoadState = 'idle' | 'loading' | 'loaded' | 'error';

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
  scenario: {
    scenarioId: string | null;
    playing: boolean;
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
  setScenario(id: string, playing: boolean): void;
  setDriverStatus(status: DriverStatus): void;
  setBundle(bundle: AgentDataBundle): void;
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
  scenario: {
    scenarioId: null,
    playing: false,
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
  setScenario(id, playing) {
    set({ scenario: { scenarioId: id, playing } });
  },
  setDriverStatus(status) {
    set({ driver: { status } });
  },
  setBundle(bundle) {
    set({ bundle });
  },
}));
