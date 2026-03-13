// RL-FEAT-005 — Shared lip sync bridge
// Connects TTS audio volume (use-speech-playback) → Live2D lip sync plugin (use-live2d)

import { create } from 'zustand';

interface LipSyncState {
  /** Current mouth-open target value (0..1) driven by TTS audio analyser */
  mouthTarget: number;
  setMouthTarget: (value: number) => void;
}

export const useLipSyncBridge = create<LipSyncState>((set) => ({
  mouthTarget: 0,
  setMouthTarget: (value) => set({ mouthTarget: value }),
}));
