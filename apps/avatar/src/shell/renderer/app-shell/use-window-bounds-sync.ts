// Wave 4 — React glue between window-bounds-policy and the live shell.
//
// Wires the policy-driven recomputer (`window-bounds.ts`) to:
//   - the active embodiment backend's intrinsic surface bounds (provided by
//     caller via `getEmbodimentBounds`)
//   - the per-avatar scale source (defaults to 1 until Wave 5 wires
//     persistent wheel scale)
//   - the avatar store's model.loadState / model.modelId (source of
//     model_load + model_switch triggers)
//   - the shared host window bridge (`avatar-window-commands.ts.setWindowSize`)
//
// IMPORTANT - feedback-loop avoidance:
// We deliberately do NOT measure DOM bounding rects of embodiment-stage or
// other window-sized nodes as inputs. Bounds come from the backend projection.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useAvatarStore } from './app-store.js';
import {
  constrainWindowToVisibleArea,
  setIgnoreCursorEvents,
  setWindowSize,
} from './avatar-window-commands.js';
import { hasAvatarHostRuntime } from './avatar-host-bridge.js';
import { isAvatarSenderInvalidated } from './window-command-lifecycle.js';
import {
  WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE,
  createWindowBoundsRecomputer,
  type WindowBoundsRecomputer,
  type WindowBoundsTrigger,
} from './window-bounds.js';

export type UseWindowBoundsSyncInput = {
  // Whether bootstrap is past the gate that allows shell composition to be
  // ready. Recomputer subscribes lazily once this flips true.
  isReady: boolean;
  // Embodiment backend's intrinsic surface bounds (NOT the DOM rect of
  // embodiment-stage). Returns null when the backend has not yet exposed
  // a stable bounds source — recomputer skips setSize in that case.
  getEmbodimentBounds: () => { width: number; height: number } | null;
  getAvatarScale?: () => number;
  avatarScale?: number;
  /** Increments when a mounted backend publishes refined validated geometry. */
  surfaceBoundsRevision?: number;
};

export function useWindowBoundsSync(input: UseWindowBoundsSyncInput): void {
  const {
    isReady,
    getEmbodimentBounds,
    getAvatarScale,
    avatarScale,
    surfaceBoundsRevision = 0,
  } = input;
  const avatarScaleRef = useRef(avatarScale ?? WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE);
  const senderInvalidatedRef = useRef(false);
  avatarScaleRef.current = avatarScale ?? WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE;

  // Each ready/backend scope owns its pending native work. Ordinary rerenders
  // reuse it; replacement, loss of readiness, and unmount retire it.
  const recomputer: WindowBoundsRecomputer = useMemo(() => {
    let active = true;
    const mayContinue = () => {
      if (active && !senderInvalidatedRef.current) return true;
      current.dispose();
      return false;
    };
    const current = createWindowBoundsRecomputer({
      getEmbodimentBounds,
      getAvatarScale:
        getAvatarScale
        ?? (() => avatarScaleRef.current),
      applySize: async (size) => {
        if (!mayContinue() || !hasAvatarHostRuntime()) return;
        try {
          await setWindowSize(size.width, size.height);
          if (!mayContinue()) return;
          await constrainWindowToVisibleArea();
          if (!mayContinue()) return;
          await setIgnoreCursorEvents(false);
        } catch (error) {
          if (!isAvatarSenderInvalidated(error)) throw error;
          senderInvalidatedRef.current = true;
          active = false;
          current.dispose();
        }
      },
      onRecomputed: ({ width, height }) => {
        useAvatarStore.getState().setWindowSize({ width, height });
      },
    });
    if (senderInvalidatedRef.current) current.dispose();
    return {
      trigger: current.trigger,
      dispose() { active = false; current.dispose(); },
    };
  }, [getAvatarScale, getEmbodimentBounds, isReady]);

  useLayoutEffect(() => () => recomputer.dispose(), [recomputer]);

  const previousAvatarScaleRef = useRef<number | null>(null);
  const previousSurfaceBoundsRevisionRef = useRef<number | null>(null);

  // Subscribe to model load state. On `loaded` we fire model_load the first
  // time, model_switch on subsequent loads (modelId change).
  useEffect(() => {
    if (!isReady) return;
    let lastModelId: string | null = null;
    const initial = useAvatarStore.getState().model;
    if (initial.loadState === 'loaded' && initial.modelId) {
      lastModelId = initial.modelId;
      recomputer.trigger('model_load');
    }
    const unsubscribe = useAvatarStore.subscribe((state, prev) => {
      const m = state.model;
      const p = prev.model;
      if (m.loadState !== 'loaded' || !m.modelId) return;
      const becameLoaded = p.loadState !== 'loaded';
      const switched = lastModelId !== null && lastModelId !== m.modelId;
      if (!becameLoaded && !switched) return;
      const trigger: WindowBoundsTrigger = switched ? 'model_switch' : 'model_load';
      lastModelId = m.modelId;
      recomputer.trigger(trigger);
    });
    return unsubscribe;
  }, [isReady, recomputer]);

  useEffect(() => {
    if (!isReady || avatarScale === undefined) return;
    const previous = previousAvatarScaleRef.current;
    previousAvatarScaleRef.current = avatarScale;
    if (previous === null || previous === avatarScale) return;
    const model = useAvatarStore.getState().model;
    if (model.loadState !== 'loaded' || !model.modelId) return;
    recomputer.trigger('avatar_scale_change');
  }, [avatarScale, isReady, recomputer]);

  useEffect(() => {
    if (!isReady) return;
    const previous = previousSurfaceBoundsRevisionRef.current;
    previousSurfaceBoundsRevisionRef.current = surfaceBoundsRevision;
    if (previous === null || previous === surfaceBoundsRevision) return;
    const model = useAvatarStore.getState().model;
    if (model.loadState !== 'loaded' || !model.modelId) return;
    recomputer.trigger('surface_bounds_change');
  }, [isReady, recomputer, surfaceBoundsRevision]);
}
