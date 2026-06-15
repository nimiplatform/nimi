// Wave 4 — React glue between window-bounds-policy and the live shell.
//
// Wires the policy-driven recomputer (`window-bounds.ts`) to:
//   - the active embodiment backend's intrinsic surface bounds (provided by
//     caller via `getEmbodimentBounds`)
//   - the companion-surface root's content footprint, observed with
//     ResizeObserver per window-bounds-policy.yaml
//   - the avatar store's model.loadState / model.modelId (source of
//     model_load + model_switch triggers)
//   - the Tauri set_size invoker (`tauri-commands.ts.setWindowSize`)
//   - the avatar evidence projection (`avatar.shell.window-bounds-changed`)
//
// IMPORTANT - feedback-loop avoidance:
// We deliberately do NOT measure DOM bounding rects of embodiment-stage or
// other window-sized nodes as inputs. The companion surface is measured only
// for its fixed-width, content-height footprint.

import { useEffect, useMemo } from 'react';
import { useAvatarStore } from './app-store.js';
import { setIgnoreCursorEvents, setWindowSize } from './tauri-commands.js';
import { isTauriRuntime } from './tauri-lifecycle.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import {
  COMPANION_FOOTPRINT_MIN_HEIGHT_PX,
  createWindowBoundsRecomputer,
  type WindowBoundsRecomputer,
  type WindowBoundsTrigger,
} from './window-bounds.js';

const COMPANION_SURFACE_SELECTOR = '[data-testid="avatar-companion-surface"]';

// Companion footprint fallback - companion-surface has fixed CSS width
// (`var(--companion-surface-width)`, 232px tokens default) and content-
// driven height. Used before the root is mounted or measurable.
const COMPANION_FOOTPRINT_BASELINE_HEIGHT_PX = COMPANION_FOOTPRINT_MIN_HEIGHT_PX;
const COMPANION_FOOTPRINT_BASELINE_WIDTH_PX = 232;

export type UseWindowBoundsSyncInput = {
  // Whether bootstrap is past the gate that allows shell composition to be
  // ready. Recomputer subscribes lazily once this flips true.
  isReady: boolean;
  // Embodiment backend's intrinsic surface bounds (NOT the DOM rect of
  // embodiment-stage). Returns null when the backend has not yet exposed
  // a stable bounds source — recomputer skips setSize in that case.
  getEmbodimentBounds: () => { width: number; height: number } | null;
};

function readCompanionFootprint(): { width: number; height: number } {
  if (typeof document === 'undefined') {
    return {
      width: COMPANION_FOOTPRINT_BASELINE_WIDTH_PX,
      height: COMPANION_FOOTPRINT_BASELINE_HEIGHT_PX,
    };
  }
  const element = document.querySelector<HTMLElement>(COMPANION_SURFACE_SELECTOR);
  const rect = element?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return {
      width: COMPANION_FOOTPRINT_BASELINE_WIDTH_PX,
      height: COMPANION_FOOTPRINT_BASELINE_HEIGHT_PX,
    };
  }
  return { width: rect.width, height: rect.height };
}

export function useWindowBoundsSync(input: UseWindowBoundsSyncInput): void {
  const { isReady, getEmbodimentBounds } = input;

  // Build the recomputer once; it has no React-owned state so it survives
  // re-renders. dispose runs on unmount.
  const recomputer: WindowBoundsRecomputer = useMemo(() => {
    return createWindowBoundsRecomputer({
      getEmbodimentBounds,
      getCompanionFootprint: readCompanionFootprint,
      applySize: async (size) => {
        if (!isTauriRuntime()) return;
        await setWindowSize(size.width, size.height);
        await setIgnoreCursorEvents(false);
      },
      onRecomputed: ({ trigger, width, height, clamped, embodimentBounds, companionFootprint }) => {
        recordAvatarEvidenceEventually({
          kind: 'avatar.shell.window-bounds-changed',
          detail: {
            trigger,
            width,
            height,
            clamped,
            embodiment_bounds: {
              x: 0,
              y: 0,
              width: Math.round(embodimentBounds.width),
              height: Math.round(embodimentBounds.height),
            },
            companion_footprint: {
              width: Math.round(companionFootprint.width),
              height: Math.round(companionFootprint.height),
            },
            changed_at: new Date().toISOString(),
          },
        });
        useAvatarStore.getState().setWindowSize({ width, height });
      },
    });
  }, [getEmbodimentBounds]);

  useEffect(() => () => recomputer.dispose(), [recomputer]);

  useEffect(() => {
    if (!isReady || typeof document === 'undefined' || typeof ResizeObserver === 'undefined') {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const observeCompanion = (): boolean => {
      const element = document.querySelector<HTMLElement>(COMPANION_SURFACE_SELECTOR);
      if (!element) {
        return false;
      }
      resizeObserver = new ResizeObserver(() => {
        recomputer.trigger('companion_footprint_change');
      });
      resizeObserver.observe(element);
      recomputer.trigger('companion_footprint_change');
      return true;
    };

    if (!observeCompanion()) {
      mutationObserver = new MutationObserver(() => {
        if (!observeCompanion()) {
          return;
        }
        mutationObserver?.disconnect();
        mutationObserver = null;
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [isReady, recomputer]);

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
}
