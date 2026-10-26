// Backend-neutral wLipSync audio consumer for browser/avatar surfaces.
//
// This helper owns only the WebAudio source -> wLipSync node lifecycle and
// snapshot projection. Backend-specific mouth mapping stays with the consumer
// app/backend driver.

import type { BackendAudioConsumer, WLipSyncSnapshot } from './backend-branch.js';
import type { Profile } from 'wlipsync';

const VISEME_KEYS = ['A', 'E', 'I', 'O', 'U', 'S'] as const;
type VisemeKey = (typeof VISEME_KEYS)[number];

export type WLipSyncAudioNode = AudioWorkletNode & {
  weights: Record<string, number>;
  volume: number;
};

export type WLipSyncAudioConsumerFactory = (
  audioContext: AudioContext,
  profile: Profile,
) => Promise<WLipSyncAudioNode>;

export type WLipSyncAudioConsumerDeps = {
  profile: Profile | null;
  createNode?: WLipSyncAudioConsumerFactory;
  onSilent?: () => void;
  missingProfileMessage?: string;
  createFailureMessage?: string;
  connectFailureMessage?: string;
};

export interface WLipSyncAudioConsumer extends BackendAudioConsumer {
  isAttached(): boolean;
}

type ConsumerState = {
  audioContext: AudioContext | null;
  source: AudioBufferSourceNode | null;
  node: WLipSyncAudioNode | null;
  pendingNodePromise: Promise<void> | null;
  warnedNoProfile: boolean;
  attachRevision: number;
};

function emptySnapshot(): WLipSyncSnapshot {
  return {
    weights: { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 },
    volume: 0,
  };
}

function projectWeights(weights: Record<string, number>): Record<VisemeKey, number> {
  const out: Record<VisemeKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 };
  for (const k of VISEME_KEYS) {
    const value = weights[k];
    out[k] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  return out;
}

// @nimi-authority: rule.nimi.avatar.embodiment.r005
export function createWLipSyncAudioConsumer(
  deps: WLipSyncAudioConsumerDeps,
): WLipSyncAudioConsumer {
  const state: ConsumerState = {
    audioContext: null,
    source: null,
    node: null,
    pendingNodePromise: null,
    warnedNoProfile: false,
    attachRevision: 0,
  };

  const factory: WLipSyncAudioConsumerFactory =
    deps.createNode ??
    (async (audioContext, profile) => {
      const { createWLipSyncNode } = await import('wlipsync');
      return createWLipSyncNode(audioContext, profile) as Promise<WLipSyncAudioNode>;
    });

  function detach(): void {
    state.attachRevision += 1;
    if (state.source && state.node) {
      try {
        state.source.disconnect(state.node);
      } catch {
        // Disconnect can throw if already disconnected.
      }
    }
    state.source = null;
  }

  function releaseNode(node: WLipSyncAudioNode): void {
    try { node.disconnect(); } catch { /* Already disconnected. */ }
    node.port.onmessage = null;
    node.port.close();
  }

  return {
    async attachAudioSource(source, audioContext) {
      detach();
      const attachRevision = state.attachRevision;
      if (!deps.profile) {
        if (!state.warnedNoProfile) {
          state.warnedNoProfile = true;
          console.warn(deps.missingProfileMessage ?? '[avatar:lipsync] wlipsync profile missing; lipsync silent');
        }
        deps.onSilent?.();
        return;
      }

      if (state.audioContext !== audioContext) {
        if (state.node) releaseNode(state.node);
        state.audioContext = audioContext;
        state.node = null;
        state.pendingNodePromise = null;
      }
      if (!state.node && !state.pendingNodePromise) {
        const profile = deps.profile;
        const pending = factory(audioContext, profile)
          .then((node) => {
            // Context identity alone is insufficient for an A/B/A switch.
            if (state.audioContext !== audioContext || state.pendingNodePromise !== pending) {
              releaseNode(node);
              return;
            }
            state.node = node;
          })
          .catch((err: unknown) => {
            if (state.audioContext !== audioContext || state.pendingNodePromise !== pending) return;
            console.warn(
              deps.createFailureMessage ?? '[avatar:lipsync] createWLipSyncNode failed; lipsync silent',
              err,
            );
          })
          .finally(() => {
            if (state.pendingNodePromise === pending) {
              state.pendingNodePromise = null;
            }
          });
        state.pendingNodePromise = pending;
      }
      if (state.pendingNodePromise) await state.pendingNodePromise;

      if (attachRevision !== state.attachRevision) {
        return;
      }
      if (!state.node) {
        deps.onSilent?.();
        return;
      }

      try {
        source.connect(state.node);
        state.source = source;
      } catch (err) {
        console.warn(
          deps.connectFailureMessage ?? '[avatar:lipsync] source.connect(wlipsync) failed',
          err,
        );
        deps.onSilent?.();
      }
    },

    detachAudioSource() {
      detach();
    },

    silent() {
      detach();
      deps.onSilent?.();
    },

    snapshot() {
      if (!state.node || !state.source) return null;
      const weights = state.node.weights;
      const volume = state.node.volume;
      if (!weights || typeof volume !== 'number') {
        return emptySnapshot();
      }
      return {
        weights: projectWeights(weights),
        volume,
      };
    },

    isAttached() {
      return state.source !== null;
    },
  };
}
