// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// VRM lipsync driver — translates per-frame `WLipSyncSnapshot` (6-dim
// AEIOUS weights + volume from the wLipSync worklet) into VRM viseme
// expression preset writes (aa/ih/ou/ee/oh) using a winner+runner top-2
// selection blended through an attack/release envelope.
//
// Algorithm lineage: airi `composables/vrm/lip-sync` (MIT). Re-implemented
// under the Avatar VRM audio boundary. Constants are exported for the local
// projection implementation.
//
// Coordination under rule.nimi.avatar.embodiment.r062:
// the surface useFrame loop calls `tick(...)` and immediately forwards
// the returned `{ active }` flag to `emoteState.setLipsyncActive(active)`
// so the emote layer suppresses viseme writes during active speech.
// `silent(vrm)` is invoked at carrier shutdown / interrupt / synthetic
// fail-close; it zeros all 5 viseme presets and the smoothing state.
//
// `expressionManager.setValue` is wrapped in try/catch — if the model
// is missing a viseme preset (e.g. only 4 of 5 are authored), the call
// throws and we silently skip; other presets continue to flush this
// frame. This matches the same partial-degrade contract that
// `vrm-emote-state.ts` enforces (see `safeSetExpression` there).

import type { VRM } from '@pixiv/three-vrm';
import type { WLipSyncSnapshot } from '@nimiplatform/kit/features/avatar/headless';

/** Attack-rate exponential coefficient (1/sec). Used when the target
 *  weight for a viseme is rising. Higher → snappier mouth open. */
export const ATTACK_RATE = 50;
/** Release-rate exponential coefficient (1/sec). Used when the target
 *  weight is falling. Lower than attack → graceful close. */
export const RELEASE_RATE = 30;
/** Maximum weight applied to the winner viseme expression preset.
 *  Caps "smiles too much" / over-saturation effect. */
export const CAP = 0.7;
/** Maximum weight applied to the runner-up (second-place) viseme. */
export const RUNNER_CAP = CAP * 0.5;
/** Multiplicative scalar applied to runner-up raw weight before it is
 *  clamped against RUNNER_CAP. Mirrors airi's 0.6 gain. */
export const RUNNER_GAIN = 0.6;
/** Below this normalized amplitude the frame is treated as silent. */
export const SILENCE_VOL = 0.04;
/** Below this projected winner weight the frame is treated as silent. */
export const SILENCE_GAIN = 0.05;
/** Idle window: if no active frame within this many ms, force silent. */
export const IDLE_MS = 160;
/** Output scaling applied at flush time (avoids over-articulation). */
export const WEIGHT_SCALE = 0.7;
/** Below this smoothed weight, output is forced to 0 (anti-jitter). */
export const MIN_OUTPUT = 0.01;

export type LipKey = 'A' | 'E' | 'I' | 'O' | 'U';
export const LIP_KEYS: readonly LipKey[] = ['A', 'E', 'I', 'O', 'U'];

/** Raw wLipSync key → projected LipKey. `S` (sibilant) projects to `I`
 *  per airi decision (lateral / closed-tooth viseme overlap). */
export const RAW_TO_LIP: Readonly<Record<'A' | 'E' | 'I' | 'O' | 'U' | 'S', LipKey>> =
  Object.freeze({
    A: 'A',
    E: 'E',
    I: 'I',
    O: 'O',
    U: 'U',
    S: 'I',
  });

/** LipKey → VRM expression preset name. Standard VRM 1.0 preset
 *  names; matches `VISEME_NAMES` in vrm-emote-state.ts (the set the
 *  emote layer suppresses while lipsync is active). */
export const VRM_PRESET: Readonly<Record<LipKey, string>> = Object.freeze({
  A: 'aa',
  E: 'ee',
  I: 'ih',
  O: 'oh',
  U: 'ou',
});

export type VrmLipsyncDriverSnapshot = {
  smoothState: Readonly<Record<LipKey, number>>;
  lastActiveAtMs: number;
  isActive: boolean;
};

export interface VrmLipsyncDriver {
  /** Per-frame advance. The surface useFrame loop calls this, then
   *  forwards `{ active }` to `emoteState.setLipsyncActive(...)` so
   *  the emote layer can suppress viseme writes for the same frame. */
  tick(input: {
    vrm: VRM;
    deltaSec: number;
    lipsyncSnapshot: WLipSyncSnapshot | null;
  }): { active: boolean };
  /** Force all 5 viseme presets to 0 immediately and zero the smoothing
   *  state. Used at carrier shutdown, audio interrupt, and synthetic
   *  audio fail-close paths. */
  silent(vrm: VRM): void;
  /** Pure introspection for tests. */
  snapshot(): VrmLipsyncDriverSnapshot;
}

export type CreateVrmLipsyncDriverInputs = {
  /** Test seam: override `performance.now` for IDLE_MS / silence
   *  determinism. Default: real `performance.now`. */
  nowMsFn?: () => number;
};

type ExpressionManagerLike = {
  setValue: (name: string, weight: number) => void;
};

function safeSetValue(
  expressionManager: ExpressionManagerLike,
  name: string,
  weight: number,
): void {
  try {
    expressionManager.setValue(name, weight);
  } catch {
    // A missing preset degrades this local lane; other available presets still
    // flush in the same frame.
  }
}

function flush(
  expressionManager: ExpressionManagerLike,
  state: Record<LipKey, number>,
): void {
  for (const k of LIP_KEYS) {
    const sw = state[k];
    const w = sw <= MIN_OUTPUT ? 0 : sw * WEIGHT_SCALE;
    safeSetValue(expressionManager, VRM_PRESET[k], w);
  }
}

function decayAll(
  state: Record<LipKey, number>,
  deltaSec: number,
  releaseRate: number,
): void {
  // Exponential decay toward 0 with the same coefficient the active
  // path uses for falling targets.
  const decay = 1 - Math.exp(-releaseRate * deltaSec);
  for (const k of LIP_KEYS) {
    state[k] = state[k] * (1 - decay);
  }
}

export function createVrmLipsyncDriver(
  input?: CreateVrmLipsyncDriverInputs,
): VrmLipsyncDriver {
  const nowMsFn = input?.nowMsFn ?? (() => performance.now());
  const smoothState: Record<LipKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 };
  let lastActiveAtMs = 0;
  let lastActiveFlag = false;

  return {
    tick({ vrm, deltaSec, lipsyncSnapshot }) {
      const expressionManager = vrm.expressionManager as
        | ExpressionManagerLike
        | undefined
        | null;
      if (!expressionManager) {
        lastActiveFlag = false;
        return { active: false };
      }

      // Null snapshot path: no source attached or post-detach. Decay
      // smooth state toward 0 and flush so the model returns to rest.
      if (!lipsyncSnapshot) {
        decayAll(smoothState, Math.max(0, deltaSec), RELEASE_RATE);
        flush(expressionManager, smoothState);
        lastActiveFlag = false;
        return { active: false };
      }

      const dt = Math.max(0, deltaSec);
      const { weights, volume } = lipsyncSnapshot;
      // amp envelope: gamma compress + cap to 1 (airi profile).
      const ampBase = Math.min(volume * 0.9, 1);
      const amp = Math.pow(Math.max(0, ampBase), 0.7);

      // Project raw 6-dim AEIOUS weights into 5-dim LipKey domain
      // using `RAW_TO_LIP` (S → I overlap takes the max of the two).
      const projected: Record<LipKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 };
      for (const raw of ['A', 'E', 'I', 'O', 'U', 'S'] as const) {
        const lip = RAW_TO_LIP[raw];
        const rawVal = weights[raw] ?? 0;
        const projectedVal = rawVal * amp;
        if (projectedVal > projected[lip]) projected[lip] = projectedVal;
      }

      // winner+runner top-2 selection (single-pass).
      let winner: LipKey = 'I';
      let runner: LipKey = 'E';
      let winnerVal = -Infinity;
      let runnerVal = -Infinity;
      for (const k of LIP_KEYS) {
        const v = projected[k];
        if (v > winnerVal) {
          runnerVal = winnerVal;
          runner = winner;
          winnerVal = v;
          winner = k;
        } else if (v > runnerVal) {
          runnerVal = v;
          runner = k;
        }
      }

      const nowMs = nowMsFn();
      let silent = amp < SILENCE_VOL || winnerVal < SILENCE_GAIN;
      if (!silent) lastActiveAtMs = nowMs;
      if (nowMs - lastActiveAtMs > IDLE_MS) silent = true;

      const target: Record<LipKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 };
      if (!silent) {
        target[winner] = Math.min(CAP, winnerVal);
        target[runner] = Math.min(RUNNER_CAP, runnerVal * RUNNER_GAIN);
      }

      // Per-key exponential lerp with attack/release branching.
      for (const k of LIP_KEYS) {
        const from = smoothState[k];
        const to = target[k];
        const rate =
          1 - Math.exp(-(to > from ? ATTACK_RATE : RELEASE_RATE) * dt);
        smoothState[k] = from + (to - from) * rate;
      }
      flush(expressionManager, smoothState);

      lastActiveFlag = !silent;
      return { active: !silent };
    },
    silent(vrm) {
      const expressionManager = vrm.expressionManager as
        | ExpressionManagerLike
        | undefined
        | null;
      // Zero internal smoothing regardless of expressionManager presence
      // (subsequent snapshot() reads should reflect a clean state).
      for (const k of LIP_KEYS) smoothState[k] = 0;
      lastActiveFlag = false;
      // Preserve `lastActiveAtMs` through silent reset; the next active sample
      // latches its own `performance.now()` anchor.
      if (!expressionManager) return;
      for (const k of LIP_KEYS) {
        safeSetValue(expressionManager, VRM_PRESET[k], 0);
      }
    },
    snapshot() {
      // Freeze a defensive copy so consumers cannot mutate internal state.
      const frozen: Record<LipKey, number> = {
        A: smoothState.A,
        E: smoothState.E,
        I: smoothState.I,
        O: smoothState.O,
        U: smoothState.U,
      };
      return {
        smoothState: Object.freeze(frozen),
        lastActiveAtMs,
        isActive: lastActiveFlag,
      };
    },
  };
}
