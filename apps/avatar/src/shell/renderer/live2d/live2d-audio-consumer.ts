// Wave 1 (step 2) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Live2D BackendAudioConsumer — wires AudioPipeline source nodes into a
// `wlipsync` AudioWorklet so per-frame viseme weights become available
// to the Live2D lipsync driver. createWLipSyncNode is lazy and scoped
// per AudioContext (audio worklet processor registration is per-context;
// reusing across distinct AudioContexts is unsafe).
//
// Spec: backend-branch-contract.md §BackendAudioConsumer;
//       design-05 §"wLipSync 集成"; live2d-render-contract.md §7.4.

import type {
  BackendAudioConsumer,
  WLipSyncSnapshot,
} from '@nimiplatform/kit/features/avatar/headless';
import type { Profile } from 'wlipsync';

const VISEME_KEYS = ['A', 'E', 'I', 'O', 'U', 'S'] as const;
type VisemeKey = (typeof VISEME_KEYS)[number];

type WLipSyncFactory = (
  audioContext: AudioContext,
  profile: Profile,
) => Promise<AudioWorkletNode & {
  weights: Record<string, number>;
  volume: number;
}>;

export type Live2DAudioConsumerDeps = {
  /** wLipSync MFCC profile. When `null`, the consumer logs a single
   *  warning and silents on attach (degraded path; carrier-startup
   *  evidence reports `wlipsync_profile_missing`). */
  profile: Profile | null;
  /** Indirection so the carrier-side test harness can stub
   *  `createWLipSyncNode` without bundling the worklet processor. */
  createNode?: WLipSyncFactory;
  /** Sink the carrier surface tick reads from; defaults to a no-op so
   *  the consumer is safe before the surface mounts. */
  onSilent?: () => void;
};

type ConsumerState = {
  audioContext: AudioContext | null;
  source: AudioBufferSourceNode | null;
  node: (AudioWorkletNode & { weights: Record<string, number>; volume: number }) | null;
  pendingNodePromise: Promise<unknown> | null;
  warnedNoProfile: boolean;
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

export function createLive2DAudioConsumer(
  deps: Live2DAudioConsumerDeps,
): BackendAudioConsumer {
  const state: ConsumerState = {
    audioContext: null,
    source: null,
    node: null,
    pendingNodePromise: null,
    warnedNoProfile: false,
  };

  const factory: WLipSyncFactory =
    deps.createNode ??
    (async (audioContext, profile) => {
      const { createWLipSyncNode } = await import('wlipsync');
      return createWLipSyncNode(audioContext, profile) as Promise<
        AudioWorkletNode & { weights: Record<string, number>; volume: number }
      >;
    });

  function detach(): void {
    if (state.source && state.node) {
      try {
        state.source.disconnect(state.node);
      } catch {
        // Disconnect can throw if already disconnected — safe to ignore.
      }
    }
    state.source = null;
  }

  return {
    async attachAudioSource(source, audioContext) {
      if (!deps.profile) {
        if (!state.warnedNoProfile) {
          state.warnedNoProfile = true;
          console.warn(
            '[avatar:live2d:lipsync] wlipsync profile missing — lipsync silent (wave_1 carrier wiring)',
          );
        }
        deps.onSilent?.();
        return;
      }

      detach();

      if (!state.node || state.audioContext !== audioContext) {
        state.audioContext = audioContext;
        state.node = null;
        const profile = deps.profile;
        const pending = factory(audioContext, profile)
          .then((node) => {
            if (state.audioContext !== audioContext) return;
            state.node = node;
          })
          .catch((err: unknown) => {
            console.warn(
              '[avatar:live2d:lipsync] createWLipSyncNode failed; lipsync silent',
              err,
            );
            deps.onSilent?.();
          })
          .finally(() => {
            if (state.pendingNodePromise === pending) {
              state.pendingNodePromise = null;
            }
          });
        state.pendingNodePromise = pending;
        await pending;
      }

      if (!state.node) {
        deps.onSilent?.();
        return;
      }

      try {
        source.connect(state.node);
        state.source = source;
      } catch (err) {
        console.warn('[avatar:live2d:lipsync] source.connect(wlipsync) failed', err);
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
      if (!state.node) return null;
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
  };
}
