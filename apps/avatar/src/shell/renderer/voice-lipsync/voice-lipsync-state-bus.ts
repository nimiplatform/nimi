// Wave 3 — Voice/lipsync state bus.
//
// `avatar-voice-lipsync.ts` publishes runtime-projected lipsync events here as
// the canonical source of truth for `voice-companion-state`'s lipsync slice
// (mouth_open_y / audioPlaybackState / lipsyncActive / audioArtifactId).
// `App.tsx` subscribes once at boot and pipes events into the React state
// reducer. Splitting it out from the driver event channel keeps avatar event
// names (`avatar.lipsync.frame`, etc.) authoritative for downstream NAS
// handlers while exposing a typed renderer-only sink for shell state.
//
// Singleton scope: one bus per avatar renderer instance, parallel to the
// shared AudioPlaybackController. This is the right scope because both
// publishers (the lipsync pipeline) and subscribers (App-shell React state)
// live inside the same renderer; constructing more than one would split the
// lipsync truth.

import type { AudioPlaybackState } from '../voice-companion-state.js';

export type VoiceLipsyncStateBusEvent =
  | { kind: 'activate'; audioArtifactId: string }
  | { kind: 'mouth_open_y'; value: number }
  | { kind: 'audio_playback_state'; state: AudioPlaybackState }
  | { kind: 'deactivate' };

export type VoiceLipsyncStateBusListener = (event: VoiceLipsyncStateBusEvent) => void;

export class VoiceLipsyncStateBus {
  private listeners = new Set<VoiceLipsyncStateBusListener>();

  publish(event: VoiceLipsyncStateBusEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: VoiceLipsyncStateBusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

let shared: VoiceLipsyncStateBus | null = null;

export function getSharedVoiceLipsyncStateBus(): VoiceLipsyncStateBus {
  if (!shared) {
    shared = new VoiceLipsyncStateBus();
  }
  return shared;
}

export function resetSharedVoiceLipsyncStateBusForTesting(): void {
  shared = null;
}
