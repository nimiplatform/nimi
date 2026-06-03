// Renderer-local voice/lipsync pub-sub. The singleton scope is one bus per
// avatar renderer instance, parallel to the shared AudioPipelineController.
// Publishers and subscribers stay in the same renderer; constructing more
// than one would split the lipsync truth.

import type { AudioPlaybackState } from './audio-pipeline.js';

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
