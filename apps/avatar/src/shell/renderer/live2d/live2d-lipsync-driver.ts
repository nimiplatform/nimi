// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Live2D lipsync driver: maps the wLipSync 6-dim viseme weight snapshot
// onto Cubism standard mouth parameters (`ParamMouthOpenY`, optionally
// `ParamMouthForm`).
//
// Algorithm mirrors the VRM backend contract's driver envelope: per-frame
// attack/release smoothing,
// winner+runner top-2 viseme selection, silence detection. The output
// targets are written through a `setParameter` sink supplied by the
// backend session; tier-driven fallback (no `ParamMouthForm` declared)
// degrades cleanly to `ParamMouthOpenY`-only.
//
// ParamMouthForm winner-key mapping (live2d-asset-compatibility-contract
// §8) MUST be sourced from `PARAM_MOUTH_FORM_BY_WINNER` below — scattered
// hardcoded -0.6/0.4/0.8/-0.2/-0.8 literals across the codebase are a
// drift violation.

import type { WLipSyncSnapshot } from '@nimiplatform/kit/features/avatar/headless';

// ── envelope constants (mirror the contract-owned VRM driver) ─────────
const ATTACK_RATE = 50;
const RELEASE_RATE = 30;
const CAP = 0.7;
/** RUNNER_CAP MUST be expressed as `CAP * 0.5` to keep the relative
 *  relationship intact (drift check forbids literal 0.35 / 0.5). */
const RUNNER_CAP = CAP * 0.5;
const RUNNER_GAIN = 0.6;
const SILENCE_VOL = 0.04;
const SILENCE_GAIN = 0.05;
const IDLE_MS = 160;
const WEIGHT_SCALE = 0.7;
const MIN_OUTPUT = 0.01;

// ── Cubism parameter ids ───────────────────────────────────────────────
export const PARAM_MOUTH_OPEN_Y = 'ParamMouthOpenY';
export const PARAM_MOUTH_FORM = 'ParamMouthForm';

// ── Winner-key projection ──────────────────────────────────────────────
type RawKey = 'A' | 'E' | 'I' | 'O' | 'U' | 'S';
type LipKey = 'A' | 'E' | 'I' | 'O' | 'U';
const LIP_KEYS: readonly LipKey[] = ['A', 'E', 'I', 'O', 'U'];
const RAW_TO_LIP: Record<RawKey, LipKey> = {
  A: 'A',
  E: 'E',
  I: 'I',
  O: 'O',
  U: 'U',
  S: 'I',
};

/** ParamMouthForm winner-key mapping (live2d-asset-compatibility-contract
 *  §8). Const table — modifying these values requires a sibling spec bump
 *  + regression-fixture sync. */
export const PARAM_MOUTH_FORM_BY_WINNER: Readonly<Record<LipKey, number>> = Object.freeze({
  A: -0.6,
  E: 0.4,
  I: 0.8,
  O: -0.2,
  U: -0.8,
});

/** Silent / no-winner ParamMouthForm value (live2d-asset-compatibility
 *  §8 — paired with ParamMouthOpenY zero). */
export const PARAM_MOUTH_FORM_SILENT = 0;

// ── Driver surface ─────────────────────────────────────────────────────

export type Live2DLipsyncTickInput = {
  deltaSec: number;
  lipsyncSnapshot: WLipSyncSnapshot | null;
  /** Whether the validated Live2D profile declares `ParamMouthForm`. When false the
   *  driver writes `ParamMouthOpenY` only. */
  paramMouthFormSupported: boolean;
  /** Sink for parameter writes; bridges to
   *  `Live2DBackendSession.applyCommand({kind:'parameter', ...})`. */
  setParameter: (id: string, value: number) => void;
};

export type Live2DLipsyncTickResult = {
  active: boolean;
  /** Avatar-local reason why the frame produced silence; null when active. */
  silentReason:
    | 'no_source'
    | 'amp_below'
    | 'winner_gain'
    | 'idle_window'
    | null;
};

export interface Live2DLipsyncDriver {
  tick(input: Live2DLipsyncTickInput): Live2DLipsyncTickResult;
  silent(setParameter: (id: string, value: number) => void): void;
}

export function createLive2DLipsyncDriver(): Live2DLipsyncDriver {
  const smoothState: Record<LipKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 };
  let lastActiveAtMs = 0;
  let lastWinner: LipKey | null = null;

  function flushOpenY(setParameter: (id: string, value: number) => void): void {
    let openY = 0;
    for (const k of LIP_KEYS) {
      const w = smoothState[k] <= MIN_OUTPUT ? 0 : smoothState[k] * WEIGHT_SCALE;
      openY += w;
    }
    if (openY > 1) openY = 1;
    setParameter(PARAM_MOUTH_OPEN_Y, openY);
  }

  function flushForm(
    setParameter: (id: string, value: number) => void,
    paramMouthFormSupported: boolean,
    winner: LipKey | null,
  ): void {
    if (!paramMouthFormSupported) return;
    const value =
      winner === null ? PARAM_MOUTH_FORM_SILENT : PARAM_MOUTH_FORM_BY_WINNER[winner];
    setParameter(PARAM_MOUTH_FORM, value);
  }

  return {
    tick({ deltaSec, lipsyncSnapshot, paramMouthFormSupported, setParameter }) {
      if (!lipsyncSnapshot) {
        const decay = 1 - Math.exp(-RELEASE_RATE * deltaSec);
        for (const k of LIP_KEYS) smoothState[k] = smoothState[k] * (1 - decay);
        flushOpenY(setParameter);
        flushForm(setParameter, paramMouthFormSupported, null);
        lastWinner = null;
        return { active: false, silentReason: 'no_source' };
      }

      const { weights, volume } = lipsyncSnapshot;
      const amp = Math.min(volume * 0.9, 1) ** 0.7;

      const projected: Record<LipKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 };
      for (const raw of ['A', 'E', 'I', 'O', 'U', 'S'] as const) {
        const lip = RAW_TO_LIP[raw];
        const rawVal = weights[raw] ?? 0;
        projected[lip] = Math.max(projected[lip], rawVal * amp);
      }

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

      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      let silent = false;
      let silentReason: Live2DLipsyncTickResult['silentReason'] = null;
      if (amp < SILENCE_VOL) {
        silent = true;
        silentReason = 'amp_below';
      } else if (winnerVal < SILENCE_GAIN) {
        silent = true;
        silentReason = 'winner_gain';
      }
      if (!silent) {
        lastActiveAtMs = nowMs;
      } else if (nowMs - lastActiveAtMs > IDLE_MS) {
        silentReason = 'idle_window';
      }
      // Ensure we still report idle_window when stale activity exceeds IDLE_MS.
      if (!silent && nowMs - lastActiveAtMs > IDLE_MS) {
        silent = true;
        silentReason = 'idle_window';
      }

      const target: Record<LipKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 };
      if (!silent) {
        target[winner] = Math.min(CAP, winnerVal);
        target[runner] = Math.min(RUNNER_CAP, runnerVal * RUNNER_GAIN);
      }

      for (const k of LIP_KEYS) {
        const from = smoothState[k];
        const to = target[k];
        const rate = 1 - Math.exp(-(to > from ? ATTACK_RATE : RELEASE_RATE) * deltaSec);
        smoothState[k] = from + (to - from) * rate;
      }

      flushOpenY(setParameter);
      const formWinner = silent ? null : winner;
      flushForm(setParameter, paramMouthFormSupported, formWinner);
      lastWinner = formWinner;

      return silent
        ? { active: false, silentReason: silentReason ?? 'amp_below' }
        : { active: true, silentReason: null };
    },
    silent(setParameter) {
      for (const k of LIP_KEYS) smoothState[k] = 0;
      lastWinner = null;
      setParameter(PARAM_MOUTH_OPEN_Y, 0);
      setParameter(PARAM_MOUTH_FORM, PARAM_MOUTH_FORM_SILENT);
    },
  };
}

/** Re-export for tests / drift audits. */
export const __INTERNALS__ = Object.freeze({
  ATTACK_RATE,
  RELEASE_RATE,
  CAP,
  RUNNER_CAP,
  RUNNER_GAIN,
  SILENCE_VOL,
  SILENCE_GAIN,
  IDLE_MS,
  WEIGHT_SCALE,
  MIN_OUTPUT,
});
