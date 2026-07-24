// Contract tests for docs/authority/avatar-embodiment-rationale.md.
//
// Tests for vrm-render-target. Most cases use stubMode because jsdom
// does not provide WebGL. The real-WebGL path is exercised via a
// `typeof WebGLRenderingContext` guard.

import { describe, expect, it } from 'vitest';

import { createVrmRenderTarget } from './vrm-render-target.js';

const VIEWPORT = { left: 100, top: 50, width: 400, height: 600 };

function makeFakeRenderer(width = 800, height = 1200): {
  // We intentionally use `any` for the shape: the real Three.js
  // WebGLRenderer surface is huge, but the render-target only consumes
  // a small subset of it. The stub branch only calls
  // getDrawingBufferSize when present.
   
  renderer: any;
} {
  return {
    renderer: {
      getDrawingBufferSize: (out: { x: number; y: number }) => {
        out.x = width;
        out.y = height;
        return out;
      },
    },
  };
}

describe('createVrmRenderTarget (stub mode)', () => {
  it('returns an instance exposing capture / probe / dispose', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    expect(typeof target.capture).toBe('function');
    expect(typeof target.probeAlphaAtClient).toBe('function');
    expect(typeof target.dispose).toBe('function');
  });

  it('capture() updates takenAtMs and returns non-zero fbo dimensions', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    const { renderer } = makeFakeRenderer(800, 1200);
    const snapshot = target.capture({
      renderer,
       
      scene: {} as any,
       
      camera: {} as any,
       
      vrm: {} as any,
    });
    expect(snapshot.takenAtMs).toBeGreaterThan(0);
    expect(snapshot.fboWidth).toBe(400); // 800 / 2
    expect(snapshot.fboHeight).toBe(600); // 1200 / 2
  });

  it('capture() clamps fbo dimensions to a 64px floor', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    const { renderer } = makeFakeRenderer(10, 10);
    const snapshot = target.capture({
      renderer,
       
      scene: {} as any,
       
      camera: {} as any,
       
      vrm: {} as any,
    });
    expect(snapshot.fboWidth).toBe(64);
    expect(snapshot.fboHeight).toBe(64);
  });

  it('probeAlphaAtClient returns null before capture()', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    const result = target.probeAlphaAtClient({
      clientX: 200,
      clientY: 200,
      viewport: VIEWPORT,
    });
    expect(result).toBeNull();
  });

  it('probeAlphaAtClient returns 255 for in-viewport coords (post-capture)', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    const { renderer } = makeFakeRenderer();
    target.capture({
      renderer,
       
      scene: {} as any,
       
      camera: {} as any,
       
      vrm: {} as any,
    });
    // Center of viewport.
    expect(
      target.probeAlphaAtClient({
        clientX: 200,
        clientY: 200,
        viewport: VIEWPORT,
      }),
    ).toBe(255);
  });

  it('probeAlphaAtClient returns 0 for outside-viewport coords (post-capture)', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    const { renderer } = makeFakeRenderer();
    target.capture({
      renderer,
       
      scene: {} as any,
       
      camera: {} as any,
       
      vrm: {} as any,
    });
    // Left of viewport.
    expect(
      target.probeAlphaAtClient({
        clientX: 50,
        clientY: 200,
        viewport: VIEWPORT,
      }),
    ).toBe(0);
    // Above viewport.
    expect(
      target.probeAlphaAtClient({
        clientX: 200,
        clientY: 10,
        viewport: VIEWPORT,
      }),
    ).toBe(0);
    // Right of viewport (boundary excluded).
    expect(
      target.probeAlphaAtClient({
        clientX: VIEWPORT.left + VIEWPORT.width,
        clientY: 200,
        viewport: VIEWPORT,
      }),
    ).toBe(0);
    // Below viewport (boundary excluded).
    expect(
      target.probeAlphaAtClient({
        clientX: 200,
        clientY: VIEWPORT.top + VIEWPORT.height,
        viewport: VIEWPORT,
      }),
    ).toBe(0);
  });

  it('dispose() clears state; subsequent probeAlphaAtClient returns null', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    const { renderer } = makeFakeRenderer();
    target.capture({
      renderer,
       
      scene: {} as any,
       
      camera: {} as any,
       
      vrm: {} as any,
    });
    target.dispose();
    expect(
      target.probeAlphaAtClient({
        clientX: 200,
        clientY: 200,
        viewport: VIEWPORT,
      }),
    ).toBeNull();
  });

  it('capture() after dispose throws (fail-close)', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    target.dispose();
    expect(() =>
      target.capture({
        renderer: makeFakeRenderer().renderer,
         
        scene: {} as any,
         
        camera: {} as any,
         
        vrm: {} as any,
      }),
    ).toThrow();
  });
});

describe('createVrmRenderTarget (real WebGL path)', () => {
  // jsdom does not provide a real WebGL implementation. Skip the real
  // path test in that environment; it will run when this suite is
  // ported to a browser-like harness with WebGL backing.
  const hasWebgl =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { WebGLRenderingContext?: unknown })
      .WebGLRenderingContext !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function' &&
    (() => {
      try {
        const c = document.createElement('canvas');
        return c.getContext('webgl2') != null || c.getContext('webgl') != null;
      } catch {
        return false;
      }
    })();

  it.skipIf(!hasWebgl)('returns an instance even outside stub mode', () => {
    // Smoke-only: we don't drive a real Three.js render pipeline in
    // unit tests. The integration coverage lives downstream of
    // chunk 4-B (vrm-hit-region wiring).
    const target = createVrmRenderTarget({ stubMode: false });
    expect(typeof target.capture).toBe('function');
    target.dispose();
  });
});
