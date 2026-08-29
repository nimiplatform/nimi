// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Avatar-owned VRM diagnostics. The active runtime stays module-local and
// only a bounded snapshot is projected to the Avatar debug-session owner. No
// renderer global exposes the concrete runtime or a private debug client.
//
// The diagnostics scope covers internal render state, retry flag, VRM loaded flag, instance
// cache stats, and `framedHeight`/`framedWidth` from the most recent
// surface frame (or null pre-ready). `frameStats.visibleDrawableCount`
// stays null because this diagnostics surface does not own visual-pixel
// measurement. DO NOT fake a number; tests assert it stays null.

import { vrmCacheStats } from './vrm-instance-cache.js';
import type { VrmRuntime, VrmRenderState } from './vrm-runtime.js';

export type VrmDiagnosticsSnapshot = {
  state: VrmRenderState['kind'];
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

// Module-local snapshot owner so getVrmDiagnosticsSnapshot() can be called
// by the surface and Avatar debug-session owner. attachVrmDiagnostics keeps this
// in sync with the runtime and frame stats, then clears it on detach.
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
 * Attach one VRM runtime to the module-local bounded diagnostics owner.
 * Returns a detach function that clears only the matching active runtime.
 */
export function attachVrmDiagnostics(runtime: VrmRuntime): () => void {
  activeRuntime = runtime;
  // Reset frame stats — a fresh runtime resets the per-frame view.
  activeFrameStats = { framedHeight: null, framedWidth: null };
  return () => {
    if (activeRuntime === runtime) {
      activeRuntime = null;
      activeFrameStats = { framedHeight: null, framedWidth: null };
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
 * bounded diagnostics snapshot reflects the most recent framing intent.
 */
export function updateVrmDiagnosticsFrameStats(stats: VrmDiagnosticsFrameStats): void {
  activeFrameStats = {
    framedHeight: stats.framedHeight,
    framedWidth: stats.framedWidth,
  };
}
