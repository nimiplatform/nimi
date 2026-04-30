// Wave 4 chunk 4-A of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Offscreen WebGL render target for VRM alpha-mask hit-region probing. The
// VRM scene is normally rendered to the visible canvas via R3F; for hit
// queries (per app-shell-contract.md §2.3.1) we need to read pixel alpha
// at client coordinates without disrupting the main render. This module
// owns the offscreen FBO + 1×1 alpha probe used by the upcoming
// vrm-hit-region (chunk 4-B) wiring.
//
// Algorithm reference: airi `composables/render-target` + `composables/
// hit-test` (allocate 1/2-res offscreen FBO, render scene/camera into it
// on demand, then `gl.readPixels(x, y, 1, 1)` for single-point alpha).
// 0-import policy per design-12: this file MUST NOT import anything from
// the airi package directory; only the algorithm shape is reused. License:
// airi MIT.
//
// Performance notes (per packet wave-4 forbidden_shortcuts:
// `synchronous_readpixels_full_canvas`):
//   - `gl.readPixels` is a synchronous GPU stall. The 1×1 read at 1/2 res
//     keeps the per-query budget < 1ms on tier A/B baselines (verified in
//     packet acceptance_invariants).
//   - Full-canvas readPixels is explicitly forbidden by the packet; this
//     file is intentionally limited to a single-pixel readback per query.
//   - capture() should be called at most once per frame (or less; the
//     bbox-snapshot 100ms throttle implies the alpha mask only needs to
//     refresh ~10 Hz).
//
// Stub mode (`stubMode: true`) returns an in-memory fake that does not
// allocate any WebGL resources. It is sufficient for unit tests that run
// under jsdom (where real WebGL is unavailable). The stub treats any
// in-viewport client point as alpha=255 and any out-of-viewport point as
// alpha=0; this is intentionally crude and only meant to exercise the
// surrounding wiring, not the real pixel-accurate probe.

import { WebGLRenderTarget } from 'three';
import type { VRM } from '@pixiv/three-vrm';

// `three` is declared as an opaque module in three-loader-shim.d.ts (no
// workspace-wide @types/three), so we cannot `import type { ... }` named
// classes. We instead declare narrow structural types covering only the
// surface this module consumes. If @types/three is admitted later, swap
// these for the real imports.
type Vector2Like = { x: number; y: number };
type ThreeScene = unknown;
type ThreeCamera = unknown;
type ThreeWebGLRenderTarget = {
  dispose(): void;
};
type ThreeWebGLRenderer = {
  getDrawingBufferSize(out: Vector2Like): Vector2Like;
  getRenderTarget(): unknown;
  setRenderTarget(target: unknown): void;
  render(scene: ThreeScene, camera: ThreeCamera): void;
  readRenderTargetPixels(
    target: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: Uint8Array,
  ): void;
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
};

/** Minimum FBO dimension on any axis. Avoids zero-sized targets when the
 *  visible viewport collapses to ~0 (e.g. transient layout). 64px is small
 *  enough that the 1×1 readback is still trivially cheap. */
const MIN_FBO_DIMENSION = 64;

export type VrmRenderTargetSnapshot = {
  /** When this snapshot was captured (`performance.now()`). */
  takenAtMs: number;
  /** Width of the offscreen FBO (= viewport width / 2, clamped to ≥ 64). */
  fboWidth: number;
  /** Height of the offscreen FBO (= viewport height / 2, clamped to ≥ 64). */
  fboHeight: number;
};

export interface VrmRenderTarget {
  /** Render the scene to the offscreen FBO. Call this at most once per
   *  frame (or less; alpha-mask hit query doesn't need every frame — bbox
   *  snapshot 100ms throttle implies we can refresh the FBO ~10Hz). */
  capture(input: {
    renderer: ThreeWebGLRenderer;
    scene: ThreeScene;
    camera: ThreeCamera;
    vrm: VRM;
  }): VrmRenderTargetSnapshot;

  /** Probe alpha at viewport client coordinate (clientX, clientY). Returns
   *  the alpha byte [0, 255] or null if the FBO has not been captured yet
   *  / the target is unavailable. clientX/clientY are window-coordinate
   *  pixels; the function maps them to FBO coordinates internally. */
  probeAlphaAtClient(input: {
    clientX: number;
    clientY: number;
    /** Viewport offset on screen (left/top of the avatar canvas in window
     *  coords) and visible dimensions. */
    viewport: { left: number; top: number; width: number; height: number };
  }): number | null;

  /** Free FBO + texture allocations. */
  dispose(): void;
}

export type CreateVrmRenderTargetInputs = {
  /** Test seam: skip real WebGL (returns a stub that resolves alpha=255
   *  for points within viewport, alpha=0 otherwise; sufficient for unit
   *  tests that don't have real WebGL). */
  stubMode?: boolean;
};

/**
 * Construct a {@link VrmRenderTarget}. In `stubMode`, returns an
 * in-memory fake; otherwise returns a real Three.js-backed implementation
 * that allocates a `WebGLRenderTarget` lazily on the first `capture()`.
 */
export function createVrmRenderTarget(
  input: CreateVrmRenderTargetInputs = {},
): VrmRenderTarget {
  if (input.stubMode === true) {
    return createStubRenderTarget();
  }
  return createRealRenderTarget();
}

// ---------------------------------------------------------------------------
// Stub implementation (jsdom-friendly; no WebGL).
// ---------------------------------------------------------------------------

function createStubRenderTarget(): VrmRenderTarget {
  let captured: VrmRenderTargetSnapshot | null = null;
  let disposed = false;

  return {
    capture(input) {
      if (disposed) {
        throw new Error('vrm-render-target: capture() after dispose()');
      }
      // The stub doesn't touch the renderer; it only records dimensions
      // so subsequent probes can answer with a sensible shape. We try to
      // read drawingBufferSize when the renderer mock supports it; we
      // otherwise fall back to the minimum FBO dimension.
      let fboWidth = MIN_FBO_DIMENSION;
      let fboHeight = MIN_FBO_DIMENSION;
      const sized = readDrawingBufferSize(input.renderer);
      if (sized != null) {
        fboWidth = Math.max(MIN_FBO_DIMENSION, Math.floor(sized.x / 2));
        fboHeight = Math.max(MIN_FBO_DIMENSION, Math.floor(sized.y / 2));
      }
      captured = {
        takenAtMs: nowMs(),
        fboWidth,
        fboHeight,
      };
      return captured;
    },
    probeAlphaAtClient(input) {
      if (disposed) return null;
      if (captured == null) return null;
      const { clientX, clientY, viewport } = input;
      if (
        clientX < viewport.left ||
        clientX >= viewport.left + viewport.width ||
        clientY < viewport.top ||
        clientY >= viewport.top + viewport.height
      ) {
        return 0;
      }
      return 255;
    },
    dispose() {
      disposed = true;
      captured = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Real implementation (Three.js WebGLRenderTarget + readPixels).
// ---------------------------------------------------------------------------

function createRealRenderTarget(): VrmRenderTarget {
  let target: ThreeWebGLRenderTarget | null = null;
  let lastWidth = 0;
  let lastHeight = 0;
  let snapshot: VrmRenderTargetSnapshot | null = null;
  let lastRenderer: ThreeWebGLRenderer | null = null;
  let disposed = false;

  return {
    capture(input) {
      if (disposed) {
        throw new Error('vrm-render-target: capture() after dispose()');
      }
      const { renderer, scene, camera } = input;
      // Compute FBO size = drawing buffer / 2 (1/2 res sampling per
      // app-shell-contract.md §2.3.1). Clamp away from zero to avoid
      // degenerate targets during transient layouts.
      const sized = readDrawingBufferSize(renderer);
      const drawX = sized?.x ?? MIN_FBO_DIMENSION * 2;
      const drawY = sized?.y ?? MIN_FBO_DIMENSION * 2;
      const fboWidth = Math.max(MIN_FBO_DIMENSION, Math.floor(drawX / 2));
      const fboHeight = Math.max(MIN_FBO_DIMENSION, Math.floor(drawY / 2));
      if (target == null || lastWidth !== fboWidth || lastHeight !== fboHeight) {
        target?.dispose();
        target = new WebGLRenderTarget(fboWidth, fboHeight);
        lastWidth = fboWidth;
        lastHeight = fboHeight;
      }
      // Render scene+camera to the offscreen FBO. Restore the previous
      // render target so the main R3F render loop is undisturbed.
      const previousTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
      }
      lastRenderer = renderer;
      snapshot = {
        takenAtMs: nowMs(),
        fboWidth,
        fboHeight,
      };
      return snapshot;
    },
    probeAlphaAtClient(input) {
      if (disposed) return null;
      if (target == null || snapshot == null || lastRenderer == null) return null;
      const { clientX, clientY, viewport } = input;
      if (viewport.width <= 0 || viewport.height <= 0) return null;
      // Map client coord → viewport-relative [0, 1] → FBO coord. WebGL
      // `readPixels` Y origin is bottom-left, opposite of the
      // window-coordinate top-left convention.
      const relX = (clientX - viewport.left) / viewport.width;
      const relYTop = (clientY - viewport.top) / viewport.height;
      if (relX < 0 || relX >= 1 || relYTop < 0 || relYTop >= 1) return null;
      const fboX = Math.min(
        snapshot.fboWidth - 1,
        Math.max(0, Math.floor(relX * snapshot.fboWidth)),
      );
      const fboYTopLeft = Math.min(
        snapshot.fboHeight - 1,
        Math.max(0, Math.floor(relYTop * snapshot.fboHeight)),
      );
      const fboY = snapshot.fboHeight - 1 - fboYTopLeft;
      // 1×1 RGBA byte readback. Synchronous GPU stall by design — a
      // 1-pixel read at 1/2 res keeps the per-query budget < 1ms on tier
      // A/B baselines. Full-canvas reads are forbidden (packet
      // forbidden_shortcuts: synchronous_readpixels_full_canvas).
      const pixels = new Uint8Array(4);
      try {
        // Three.js public API: readRenderTargetPixels binds the FBO and
        // issues `gl.readPixels(x, y, w, h, RGBA, UNSIGNED_BYTE, out)`.
        // We never reach into private state.
        lastRenderer.readRenderTargetPixels(
          target,
          fboX,
          fboY,
          1,
          1,
          pixels,
        );
      } catch {
        return null;
      }
      return pixels[3] ?? 0;
    },
    dispose() {
      disposed = true;
      target?.dispose();
      target = null;
      snapshot = null;
      lastRenderer = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Read renderer.getDrawingBufferSize defensively (mocks in tests may
 *  not implement it; real Three.js requires a Vector2 target). Returns
 *  null when the renderer doesn't expose the API. */
function readDrawingBufferSize(
  renderer: ThreeWebGLRenderer,
): { x: number; y: number } | null {
  const fn = (renderer as { getDrawingBufferSize?: unknown }).getDrawingBufferSize;
  if (typeof fn !== 'function') return null;
  try {
    const target = { x: 0, y: 0 };
    const result = (fn as (out: { x: number; y: number }) => unknown).call(
      renderer,
      target,
    );
    // Three.js mutates the passed Vector2 and returns it. Some test
    // doubles return a fresh object instead. Accept either.
    const r = (result ?? target) as { x?: unknown; y?: unknown };
    if (typeof r.x === 'number' && typeof r.y === 'number') {
      return { x: r.x, y: r.y };
    }
    if (typeof target.x === 'number' && typeof target.y === 'number') {
      return { x: target.x, y: target.y };
    }
    return null;
  } catch {
    return null;
  }
}
