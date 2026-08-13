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

import { useEffect, useMemo, useRef } from 'react';
import { useAvatarStore } from './app-store.js';
import { setIgnoreCursorEvents, setWindowSize } from './avatar-window-commands.js';
import { isTauriRuntime } from './tauri-lifecycle.js';
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
};

export function useWindowBoundsSync(input: UseWindowBoundsSyncInput): void {
  const { isReady, getEmbodimentBounds, getAvatarScale, avatarScale } = input;
  const avatarScaleRef = useRef(avatarScale ?? WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE);
  avatarScaleRef.current = avatarScale ?? WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE;

  // Build the recomputer once; it has no React-owned state so it survives
  // re-renders. dispose runs on unmount.
  const recomputer: WindowBoundsRecomputer = useMemo(() => {
    return createWindowBoundsRecomputer({
      getEmbodimentBounds,
      getAvatarScale:
        getAvatarScale
        ?? (() => avatarScaleRef.current),
      applySize: async (size) => {
        if (!isTauriRuntime()) return;
        await setWindowSize(size.width, size.height);
        await setIgnoreCursorEvents(false);
      },
      onRecomputed: ({ width, height }) => {
        useAvatarStore.getState().setWindowSize({ width, height });
      },
    });
  }, [getAvatarScale, getEmbodimentBounds]);

  useEffect(() => () => recomputer.dispose(), [recomputer]);

  const previousAvatarScaleRef = useRef<number | null>(null);

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
}
