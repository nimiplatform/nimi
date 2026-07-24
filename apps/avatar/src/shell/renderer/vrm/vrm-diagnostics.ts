// Authority: docs/authority/avatar-embodiment-rationale.md.
//
// In-browser VRM diagnostics. Mirrors the Live2D debug pattern documented
// in `apps/avatar/AGENTS.md` §"Live2D Debugging Workflow" — but unlike
// Live2D (which attaches debug snippets to a canvas DOM element), VRM
// runs inside an R3F `<Canvas>` whose internal Three.js scene is not a
// stable DOM target. Instead we attach the snapshot fn to a stable
// global key (`window.nimi.avatar.vrm.debug`) so devs can call
// `nimi.avatar.vrm.debug.snapshot()` from the browser console at any time.
//
// SSR-safe: when `typeof window === 'undefined'` (Node test env without
// jsdom global, server prerender), `attachVrmDiagnostics` is a no-op
// returning a no-op detach fn — no global pollution and no errors.
//
// The diagnostics scope covers lifecycle state, retry flag, VRM loaded flag, instance
// cache stats, and `framedHeight`/`framedWidth` from the most recent
// surface frame (or null pre-ready). `frameStats.visibleDrawableCount`
// stays null because this diagnostics surface does not own visual-pixel
// measurement. DO NOT fake a number; tests assert it stays null.

import { vrmCacheStats } from './vrm-instance-cache.js';
import type { VrmRuntime, VrmLifecycleState } from './vrm-runtime.js';

export type VrmDiagnosticsSnapshot = {
  state: VrmLifecycleState['kind'];
  retryAttempted: boolean;
  vrmLoaded: boolean;
  cacheStats: { size: number; urls: string[] };
  frameStats: {
    /** Always null on this diagnostics surface; visual acceptance owns pixels. */
    visibleDrawableCount: number | null;
    framedHeight: number | null;
    framedWidth: number | null;
  };
};

export type VrmDiagnosticsFrameStats = {
  framedHeight: number | null;
  framedWidth: number | null;
};

type DiagnosticsGlobal = {
  snapshot: () => VrmDiagnosticsSnapshot;
  runtime: VrmRuntime;
};

type WindowWithDiagnostics = Window & {
  nimi?: {
    avatar?: {
      vrm?: {
        debug?: DiagnosticsGlobal;
      };
    };
  };
};

const NOOP_DETACH = (): void => {};

// Module-local snapshot owner so getVrmDiagnosticsSnapshot() can be called
// from tests + the surface programmatically without going through the
// window global. attachVrmDiagnostics keeps this in sync with the runtime
// + frame stats; clears on detach.
let activeRuntime: VrmRuntime | null = null;
let activeFrameStats: VrmDiagnosticsFrameStats = {
  framedHeight: null,
  framedWidth: null,
};

function buildSnapshot(runtime: VrmRuntime): VrmDiagnosticsSnapshot {
  const state = runtime.getState();
  return {
    state: state.kind,
    retryAttempted: state.kind === 'context_lost' ? state.retried : false,
    vrmLoaded: state.kind === 'ready' || state.kind === 'context_lost',
    cacheStats: vrmCacheStats(),
    frameStats: {
      // Visual acceptance owns this measurement; see the header comment.
      visibleDrawableCount: null,
      framedHeight: activeFrameStats.framedHeight,
      framedWidth: activeFrameStats.framedWidth,
    },
  };
}

/**
 * Attach the VRM diagnostics global (`window.nimi.avatar.vrm.debug`) so
 * devs can call `.snapshot()` from the console. Returns a detach fn that
 * removes the global and clears the module-local active runtime.
 *
 * SSR-safe: returns a no-op detach when `window` is undefined.
 */
export function attachVrmDiagnostics(runtime: VrmRuntime): () => void {
  activeRuntime = runtime;
  // Reset frame stats — a fresh runtime resets the per-frame view.
  activeFrameStats = { framedHeight: null, framedWidth: null };

  if (typeof window === 'undefined') {
    return NOOP_DETACH;
  }
  const w = window as WindowWithDiagnostics;
  const root = (w.nimi ??= {});
  const avatar = (root.avatar ??= {});
  const vrm = (avatar.vrm ??= {});
  vrm.debug = {
    snapshot: () => buildSnapshot(runtime),
    runtime,
  };
  return () => {
    if (activeRuntime === runtime) {
      activeRuntime = null;
      activeFrameStats = { framedHeight: null, framedWidth: null };
    }
    if (typeof window === 'undefined') return;
    const ww = window as WindowWithDiagnostics;
    const ns = ww.nimi?.avatar?.vrm;
    if (ns && ns.debug && ns.debug.runtime === runtime) {
      delete ns.debug;
    }
  };
}

/**
 * Get the latest snapshot from the currently-attached runtime, or null if
 * no runtime is attached. Used by tests + the surface to read state
 * programmatically without going through the window global.
 */
export function getVrmDiagnosticsSnapshot(): VrmDiagnosticsSnapshot | null {
  if (activeRuntime === null) return null;
  return buildSnapshot(activeRuntime);
}

/**
 * Update the per-frame stats reported by the snapshot (framedHeight /
 * framedWidth). Surface calls this from its framing useMemo so the
 * diagnostics global reflects the most recent applied framing intent.
 */
export function updateVrmDiagnosticsFrameStats(stats: VrmDiagnosticsFrameStats): void {
  activeFrameStats = {
    framedHeight: stats.framedHeight,
    framedWidth: stats.framedWidth,
  };
}
