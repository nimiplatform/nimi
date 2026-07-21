import type { AppAttentionState } from './app-attention-state.js';

export type AppAttentionSource = {
  getSnapshot(): AppAttentionState;
  subscribe(listener: () => void): () => void;
};
