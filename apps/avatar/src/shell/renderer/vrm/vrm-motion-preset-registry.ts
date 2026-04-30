// Wave 3 chunk 3-B of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Runtime registry that maps motion preset id → Three.js AnimationAction
// and drives crossfaded playback against a single per-VRM AnimationMixer.
// Implements NAV-VRM-003 + NAV-VRM-004 from vrm-backend-contract.md and
// the algorithm sketched in design-04 §"VrmMotionPresetRegistry".
//
// Per-model override semantics (vrm-backend-contract.md §3.3):
//   `<model_path>/motions/<preset_id>.vrma` shadows the builtin asset
//   when the same id is present in `perModelOverrides`. Both flow through
//   the same `loadAnimationOverride` test seam so unit tests can mock
//   them uniformly. Unknown override ids fall back to the builtin (the
//   override is silently dropped — the registry only processes overrides
//   whose id matches a known builtin).
//
// Crossfade semantics:
//   - First play: `nextAction.play()` on a clean mixer.
//   - Subsequent play: if a previous loop preset is active, it is
//     `stop()`-ed BEFORE the crossfade (per packet acceptance_invariant
//     "loop preset is stopped before next play" + design-04). One-shot
//     (loop=false) presets are not pre-stopped — they decay naturally
//     into the crossfade.
//   - Unknown preset id → fail-close `{ played: false, reason:
//     'preset_not_loaded' }` (no fake motion, contract §3.4).

import type { VRM } from '@pixiv/three-vrm';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';

import { clipFromVRMAnimation, loadVrmAnimation } from './vrm-animation-loader.js';

// `three` is shimmed via `declare module 'three'` (no @types/three at this
// wave), so AnimationMixer / AnimationAction / AnimationClip are exposed
// as `any`. We narrow with structural aliases for the public surface.
type AnimationMixerInstance = {
  clipAction(clip: unknown): AnimationActionLike;
  update(deltaSec: number): void;
  stopAllAction(): void;
  uncacheRoot(root: unknown): void;
};
type AnimationActionLike = {
  play(): unknown;
  stop(): unknown;
  reset(): unknown;
  crossFadeTo(next: AnimationActionLike, duration: number, warp: boolean): unknown;
  timeScale: number;
  loop: number;
};
import type {
  VrmMotionPresetEntry,
  VrmMotionPresetTable,
} from './load-vrm-motion-preset-table.js';

/** Intensity clamp range. Lower bound prevents near-zero timeScale (the
 *  AnimationMixer doesn't progress); upper bound caps strong-emote tempo
 *  per packet acceptance_invariant 11. */
export const MOTION_INTENSITY_MIN = 0.5;
export const MOTION_INTENSITY_MAX = 1.4;
/** Default crossfade duration (seconds) when caller does not override. */
export const DEFAULT_MOTION_FADE_SEC = 0.3;

export type LoadAllInput = {
  vrm: VRM;
  /** Override entries from `<model_path>/motions/`. Same id as a builtin
   *  shadows that builtin's asset URL. Entries with ids not present in
   *  the builtin table are silently ignored. */
  perModelOverrides?: VrmMotionPresetEntry[];
  /** Test seam: override fetcher (default: `loadVrmAnimation`). The
   *  registry calls this with the resolved URL string. */
  loadAnimationOverride?: (url: string) => Promise<unknown | null>;
};

export type LoadAllResult = {
  loadedIds: string[];
  failedIds: Array<{ id: string; reason: string }>;
};

export type PlayInput = {
  presetId: string;
  /** Crossfade duration in seconds; default `DEFAULT_MOTION_FADE_SEC`. */
  fade?: number;
  /** Override the table's loop value (rare). */
  loop?: boolean;
  /** Tempo scalar, clamped to [MOTION_INTENSITY_MIN, MOTION_INTENSITY_MAX]. */
  intensity?: number | null;
};

export type PlayResult =
  | { played: true }
  | { played: false; reason: string };

export type RegistrySnapshot = {
  loaded: string[];
  activePresetId: string | null;
  /** Seconds of crossfade still pending; 0 when no crossfade in flight. */
  fadeRemainingSec: number;
};

export interface VrmMotionPresetRegistry {
  loadAll(input: LoadAllInput): Promise<LoadAllResult>;
  play(input: PlayInput): PlayResult;
  stopAll(): void;
  tick(deltaSec: number): void;
  snapshot(): RegistrySnapshot;
  dispose(): void;
}

export type CreateVrmMotionPresetRegistryInputs = {
  table: VrmMotionPresetTable;
  /** URL resolver: takes the registry's `builtinDir + entry.file` (or an
   *  override entry's file) and returns a URL string suitable for fetch.
   *  Default: identity passthrough (caller pre-resolves; tests can swap). */
  resolveAssetUrl?: (relativePath: string) => string;
};

function clampIntensity(raw: number | null | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  if (!Number.isFinite(raw)) return null;
  if (raw < MOTION_INTENSITY_MIN) return MOTION_INTENSITY_MIN;
  if (raw > MOTION_INTENSITY_MAX) return MOTION_INTENSITY_MAX;
  return raw;
}

function defaultResolveAssetUrl(relativePath: string): string {
  return relativePath;
}

/**
 * Construct a fresh registry instance. One registry per loaded VRM —
 * the AnimationMixer is created lazily inside `loadAll` so the registry
 * can be constructed before the VRM finishes loading.
 */
export function createVrmMotionPresetRegistry(
  input: CreateVrmMotionPresetRegistryInputs,
): VrmMotionPresetRegistry {
  const { table } = input;
  const resolveAssetUrl = input.resolveAssetUrl ?? defaultResolveAssetUrl;

  // Map preset id → registered AnimationAction. Populated by loadAll.
  const actions = new Map<string, AnimationActionLike>();
  // Map preset id → resolved entry (post-override merge), so play() can
  // read the loop default without re-walking the table.
  const entriesById = new Map<string, VrmMotionPresetEntry>();
  let mixer: AnimationMixerInstance | null = null;
  let vrmRef: VRM | null = null;
  let activePresetId: string | null = null;
  let activeAction: AnimationActionLike | null = null;
  let fadeRemainingSec = 0;

  function resolveEntryUrl(entry: VrmMotionPresetEntry, isOverride: boolean): string {
    if (isOverride) {
      // Per-model overrides use the override's `file` directly — the
      // resolver still gets a chance to massage it (e.g. convertFileSrc).
      return resolveAssetUrl(entry.file);
    }
    const rel = `${table.builtinDir}/${entry.file}`;
    return resolveAssetUrl(rel);
  }

  async function loadAll(loadInput: LoadAllInput): Promise<LoadAllResult> {
    vrmRef = loadInput.vrm;
    if (!mixer) {
      mixer = new AnimationMixer(loadInput.vrm.scene) as AnimationMixerInstance;
    }
    const m: AnimationMixerInstance = mixer;
    const fetcher = loadInput.loadAnimationOverride ?? loadVrmAnimation;
    // Build merged entry map: builtin first, override shadows by id.
    const merged = new Map<string, { entry: VrmMotionPresetEntry; isOverride: boolean }>();
    for (const e of table.presets) merged.set(e.id, { entry: e, isOverride: false });
    if (loadInput.perModelOverrides) {
      for (const e of loadInput.perModelOverrides) {
        if (!merged.has(e.id)) {
          // Unknown override id — silently drop per contract §3.3.
          continue;
        }
        merged.set(e.id, { entry: e, isOverride: true });
      }
    }
    const loadedIds: string[] = [];
    const failedIds: Array<{ id: string; reason: string }> = [];
    for (const [id, { entry, isOverride }] of merged.entries()) {
      const url = resolveEntryUrl(entry, isOverride);
      try {
        const animation = (await fetcher(url)) as VRMAnimation | null;
        if (!animation) {
          failedIds.push({ id, reason: 'animation_load_failed' });
          continue;
        }
        const clip = clipFromVRMAnimation(animation, loadInput.vrm);
        const action = m.clipAction(clip);
        action.loop = entry.loop ? LoopRepeat : LoopOnce;
        actions.set(id, action);
        entriesById.set(id, entry);
        loadedIds.push(id);
      } catch (err) {
        failedIds.push({
          id,
          reason: err instanceof Error ? err.message : 'animation_load_error',
        });
      }
    }
    return { loadedIds, failedIds };
  }

  function play(playInput: PlayInput): PlayResult {
    const next = actions.get(playInput.presetId);
    if (!next) {
      return { played: false, reason: 'preset_not_loaded' };
    }
    const entry = entriesById.get(playInput.presetId);
    const fade = playInput.fade ?? DEFAULT_MOTION_FADE_SEC;
    const loop = playInput.loop ?? entry?.loop ?? false;
    next.loop = loop ? LoopRepeat : LoopOnce;
    const intensity = clampIntensity(playInput.intensity);
    if (intensity !== null) {
      next.timeScale = intensity;
    } else {
      next.timeScale = 1;
    }
    if (activeAction && activeAction !== next) {
      // Loop preset stop-before-crossFade per acceptance_invariant 6.
      const prevEntry = activePresetId ? entriesById.get(activePresetId) : null;
      if (prevEntry?.loop) {
        activeAction.stop();
      }
      activeAction.crossFadeTo(next, fade, true);
      next.play();
      fadeRemainingSec = fade;
    } else if (activeAction === next) {
      // Re-trigger same preset: ensure it's running; reset clock.
      next.reset();
      next.play();
      fadeRemainingSec = 0;
    } else {
      next.reset();
      next.play();
      fadeRemainingSec = 0;
    }
    activeAction = next;
    activePresetId = playInput.presetId;
    return { played: true };
  }

  function stopAll(): void {
    if (mixer) mixer.stopAllAction();
    activeAction = null;
    activePresetId = null;
    fadeRemainingSec = 0;
  }

  function tick(deltaSec: number): void {
    if (!mixer) return;
    mixer.update(deltaSec);
    if (fadeRemainingSec > 0) {
      fadeRemainingSec = Math.max(0, fadeRemainingSec - deltaSec);
    }
  }

  function snapshot(): RegistrySnapshot {
    return {
      loaded: Array.from(actions.keys()),
      activePresetId,
      fadeRemainingSec,
    };
  }

  function dispose(): void {
    stopAll();
    if (mixer && vrmRef) {
      mixer.uncacheRoot(vrmRef.scene);
    }
    actions.clear();
    entriesById.clear();
    mixer = null;
    vrmRef = null;
  }

  return { loadAll, play, stopAll, tick, snapshot, dispose };
}
