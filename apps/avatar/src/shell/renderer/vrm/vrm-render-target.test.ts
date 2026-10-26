// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Tests for vrm-render-target. Most cases use stubMode because jsdom
// does not provide WebGL. The real-WebGL path is exercised via a
// `typeof WebGLRenderingContext` guard.

import { Vector2, WebGLRenderTarget } from 'three';
import { describe, expect, it, vi } from 'vitest';

import { createVrmRenderTarget, type VrmRenderTarget } from './vrm-render-target.js';

const VIEWPORT = { left: 100, top: 50, width: 400, height: 600 };

type CaptureInput = Parameters<VrmRenderTarget['capture']>[0];
type DrawingBufferTarget = Parameters<CaptureInput['renderer']['getDrawingBufferSize']>[0];

function makeFakeRenderer(width = 800, height = 1200) {
  const previousTarget = {};
  return {
    previousTarget,
    renderer: {
      // Mirror the installed Three.js receiver contract, including its actual
      // Vector2 methods. A plain x/y object must fail this boundary.
      getDrawingBufferSize: vi.fn((out: DrawingBufferTarget) => {
        expect(out).toBeInstanceOf(Vector2);
        return out.set(width, height).floor();
      }),
      getRenderTarget: vi.fn(() => previousTarget),
      setRenderTarget: vi.fn((_target: unknown) => {}),
      render: vi.fn((_scene: unknown, _camera: unknown) => {}),
      readRenderTargetPixels: vi.fn((
        _target: unknown, _x: number, _y: number, _width: number, _height: number, _buffer: Uint8Array,
      ) => {}),
      getContext(): never { throw new Error('Unit tests do not create a GPU context'); },
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

describe('createVrmRenderTarget production allocation and readback contracts', () => {
  // Real Three.js Vector2 and WebGLRenderTarget; renderer calls are observed
  // at the GPU boundary. These assertions do not claim real pixel output.
  it('uses half the actual drawing buffer, reuses the FBO, and reads only one RGBA pixel', () => {
    const target = createVrmRenderTarget();
    const { renderer, previousTarget } = makeFakeRenderer(801.9, 1201.9);
    const input: CaptureInput = { renderer, scene: {}, camera: {}, vrm: {} as CaptureInput['vrm'] };
    expect(target.capture(input)).toMatchObject({ fboWidth: 400, fboHeight: 600 });
    const fbo = renderer.setRenderTarget.mock.calls[0]?.[0] as { dispose(): void };
    expect(fbo).toBeInstanceOf(WebGLRenderTarget);
    expect(fbo).toMatchObject({ width: 400, height: 600 });
    const dispose = vi.spyOn(fbo, 'dispose');
    target.capture(input);
    expect(renderer.setRenderTarget.mock.calls.map(([value]) => value))
      .toEqual([fbo, previousTarget, fbo, previousTarget]);
    expect(dispose).not.toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.readRenderTargetPixels).not.toHaveBeenCalled();

    target.probeAlphaAtClient({ clientX: 300, clientY: 350, viewport: VIEWPORT });
    expect(renderer.readRenderTargetPixels).toHaveBeenCalledExactlyOnceWith(
      fbo, 200, 299, 1, 1, expect.any(Uint8Array),
    );
    expect(renderer.readRenderTargetPixels.mock.calls[0]?.[5].byteLength).toBe(4);

    renderer.getDrawingBufferSize.mockImplementation((out) => out.set(400, 600).floor());
    expect(target.capture(input)).toMatchObject({ fboWidth: 200, fboHeight: 300 });
    expect(dispose).toHaveBeenCalledTimes(1);
    const resized = renderer.setRenderTarget.mock.calls[4]?.[0] as { dispose(): void };
    expect(resized).not.toBe(fbo);
    const disposeResized = vi.spyOn(resized, 'dispose');
    target.dispose();
    target.dispose();
    expect(disposeResized).toHaveBeenCalledTimes(1);
    expect(target.probeAlphaAtClient({ clientX: 300, clientY: 350, viewport: VIEWPORT })).toBeNull();
    expect(renderer.readRenderTargetPixels).toHaveBeenCalledTimes(1);
  });

  it('retains the minimum-size and failed-read fallback and restores the target after render failure', () => {
    const target = createVrmRenderTarget();
    const { renderer, previousTarget } = makeFakeRenderer();
    const input: CaptureInput = { renderer, scene: {}, camera: {}, vrm: {} as CaptureInput['vrm'] };
    renderer.getDrawingBufferSize.mockImplementation(() => { throw new Error('renderer unavailable'); });
    expect(target.capture(input)).toMatchObject({ fboWidth: 64, fboHeight: 64 });
    renderer.readRenderTargetPixels.mockImplementation(() => { throw new Error('readback unavailable'); });
    expect(target.probeAlphaAtClient({ clientX: 300, clientY: 350, viewport: VIEWPORT })).toBeNull();
    renderer.render.mockImplementation(() => { throw new Error('context lost'); });
    expect(() => target.capture(input)).toThrow('context lost');
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(previousTarget);
    target.dispose();
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
