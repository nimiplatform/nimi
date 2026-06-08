// Wave 2 chunk 2-C of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Verifies the VRM BackendBranch surface (vrm-carrier-surface.tsx). Uses
// the runtime's loaderOverride seam to feed a stub VRM, and stubs out
// `@react-three/fiber` Canvas so jsdom can mount the surface without a
// real WebGL context.

import { act, render } from '@testing-library/react';
import type { VRM } from '@pixiv/three-vrm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { VrmAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import type {
  BackendAudioConsumer,
  BackendProjection,
} from '@nimiplatform/kit/features/avatar/headless';
import type { VrmEmoteState, VrmGeneratedMotionRuntime } from '@nimiplatform/kit/features/avatar/vrm';
import type { VrmLipsyncDriver } from './vrm-lipsync-driver.js';
import type { ActivityMapping } from './vrm-projection-adapter.js';
import { createVrmRenderTarget } from './vrm-render-target.js';
import { sampleVrmVisiblePixels } from './vrm-carrier-surface.js';

vi.mock('@react-three/fiber', () => ({
  // Render a plain <canvas> wrapper so the surface's webglcontextlost
  // listener has a real EventTarget to bind to.
  Canvas: ({ children }: { children?: ReactNode }) => (
    <div data-testid="r3f-canvas-mock">
      <canvas data-testid="r3f-canvas" />
      {children}
    </div>
  ),
  // useFrame is replaced with a no-op in jsdom — the chunk 3-D tests
  // exercise tick chain wiring via integration tests that drive the
  // useFrame callback directly (not through R3F's RAF loop).
  useFrame: () => {},
  // Wave 4 chunk 4-C: VrmRenderTargetCaptureLoop calls useThree to read
  // gl/scene/camera. Stubs are fine — the alpha-mask capture is wrapped
  // in try/catch and the surface tests cover lifecycle, not the probe.
  useThree: () => ({ gl: {}, scene: {}, camera: {} }),
}));

function manifest(): VrmAvatarModelManifest {
  return {
    kind: 'vrm',
    modelId: 'avatar-sample',
    runtimeDir: '/models/sample/runtime',
    nimiDir: null,
    posterPath: null,
    vrm: {
      vrmFile: '/models/sample/runtime/avatar.vrm',
      motionPresetsDir: '/models/sample/runtime/motions',
    },
  };
}

function audioConsumer(): BackendAudioConsumer {
  return {
    async attachAudioSource() {},
    detachAudioSource() {},
    silent() {},
    snapshot() {
      return null;
    },
  };
}

function emoteStateStub(): VrmEmoteState {
  return {
    setEmote() {},
    applyTransientExpression() {},
    setLipsyncActive() {},
    tick: () => ({ skippedCount: 0 }),
    reset() {},
    snapshot: () => ({
      activeEmote: null,
      targetWeights: Object.freeze({}),
      currentWeights: Object.freeze({}),
      lipsyncActive: false,
    }),
  };
}

function generatedMotionRuntimeStub(): VrmGeneratedMotionRuntime<VRM> {
  return {
    attach() {},
    play: () => ({
      played: false,
      reason: 'missing_route',
      evidence: {
        routeId: 'test',
        providerKind: 'missing',
        reasonCode: 'missing_route' as const,
      },
    }),
    stopAll() {},
    tick() {},
    snapshot: () => ({ attached: false, activeRouteId: null, fadeRemainingSec: 0 }),
    dispose() {},
  };
}

function lipsyncDriverStub(): VrmLipsyncDriver {
  return {
    tick: () => ({ active: false }),
    silent() {},
    snapshot: () => ({
      smoothState: Object.freeze({ A: 0, E: 0, I: 0, O: 0, U: 0 }),
      lastActiveAtMs: 0,
      isActive: false,
    }),
  };
}

function activityMappingStub(): ActivityMapping {
  return { resolveVrmRoute: () => null };
}

function commonExtras(): {
  emoteState: VrmEmoteState;
  generatedMotionRuntime: VrmGeneratedMotionRuntime<VRM>;
  lipsyncDriver: VrmLipsyncDriver;
  activityMapping: ActivityMapping;
  setProjectionAdapter: (adapter: BackendProjection) => void;
  renderTarget: ReturnType<typeof createVrmRenderTarget>;
} {
  return {
    emoteState: emoteStateStub(),
    generatedMotionRuntime: generatedMotionRuntimeStub(),
    lipsyncDriver: lipsyncDriverStub(),
    activityMapping: activityMappingStub(),
    setProjectionAdapter: () => {},
    // Wave 4 chunk 4-C: stub render target keeps the surface test fast +
    // jsdom-friendly. Tier C (default in jsdom — no WebGL renderer string)
    // means the alpha-mask probe is skipped, the hit region is bbox-only,
    // and the surface emits a `hit_region_degraded` evidence call.
    renderTarget: createVrmRenderTarget({ stubMode: true }),
  };
}

function stubVrm(): VRM {
  // Returned by the loader stub; the scene component is rendered into the
  // mocked canvas, so the precise shape doesn't matter for surface wiring.
  return { scene: { traverse() {} } } as unknown as VRM;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createVrmCarrierSurface', () => {
  it('samples VRM visible pixels from the render target using the acceptance grid', () => {
    const target = createVrmRenderTarget({ stubMode: true });
    target.capture({
      renderer: {
        getDrawingBufferSize: (out: { x: number; y: number }) => {
          out.x = 480;
          out.y = 720;
          return out;
        },
      } as any,
      scene: {} as any,
      camera: {} as any,
      vrm: stubVrm(),
    });

    const stats = sampleVrmVisiblePixels({
      renderTarget: target,
      viewport: { left: 0, top: 0, width: 480, height: 720 },
      gridSize: 24,
    });

    expect(stats).toEqual(expect.objectContaining({
      modelKind: 'vrm',
      sampledPixels: 576,
      visiblePixels: 576,
      gridSize: 24,
      canvasWidth: 480,
      canvasHeight: 720,
    }));
    expect(stats.sampledPixelChecksum).toBeGreaterThan(0);
  });

  it('does not convert an uncaptured render target into VRM visible-pixel success', () => {
    const target = createVrmRenderTarget({ stubMode: true });

    const stats = sampleVrmVisiblePixels({
      renderTarget: target,
      viewport: { left: 0, top: 0, width: 480, height: 720 },
      gridSize: 24,
    });

    expect(stats.sampledPixels).toBe(0);
    expect(stats.visiblePixels).toBe(0);
    expect(stats.sampledPixelChecksum).toBe(0);
  });

  it('mounts the canvas and reaches `ready` after the loader resolves', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const evidence = vi.fn();
    const onAudio = vi.fn();
    const onRegion = vi.fn();
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
      },
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component
          width={400}
          height={720}
          embodied
          onLifecycleEvidence={evidence}
          onAudioConsumerReady={onAudio}
          onHitRegionChange={onRegion}
        />,
      );
      // Flush the async loader microtasks.
      await Promise.resolve();
      await Promise.resolve();
    });

    const root = result!.getByTestId('avatar-vrm-carrier');
    expect(root.getAttribute('data-avatar-vrm-state')).toBe('ready');
    expect(result!.getByTestId('r3f-canvas')).toBeTruthy();

    // load_started fires on mount; concrete `ready` is read off the data
    // attribute (the runtime emits context_restored only after a context
    // loss recovery, not on initial load).
    expect(evidence).toHaveBeenCalledWith(
      'load_started',
      expect.objectContaining({ source: 'vrm-carrier-surface' }),
    );
    expect(evidence).toHaveBeenCalledWith(
      'generated_motion_runtime_attached',
      expect.objectContaining({ vrma_position: 'interchange_only' }),
    );

    // Audio consumer announced exactly once.
    expect(onAudio).toHaveBeenCalledTimes(1);

    // Hit region announced with full-viewport bbox + null alpha-mask.
    expect(onRegion).toHaveBeenCalledTimes(1);
    const region = onRegion.mock.calls[0]?.[0];
    expect(region?.body).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(region?.drag).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(region?.isOpaqueAtClientPoint).toBeNull();
  });

  it('webglcontextlost on canvas drives the runtime through context_lost', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
        // Capture the timer so the test deterministically holds the
        // machine in `context_lost` (no spontaneous retry firing).
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => {},
      },
    });
    const evidence = vi.fn();

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component
          width={400}
          height={720}
          embodied
          onLifecycleEvidence={evidence}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state')).toBe(
      'ready',
    );

    const canvas = result!.getByTestId('r3f-canvas') as HTMLCanvasElement;
    await act(async () => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await Promise.resolve();
    });

    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('context_lost');
    expect(evidence).toHaveBeenCalledWith(
      'context_lost',
      expect.objectContaining({ lostAt: expect.any(Number) }),
    );
  });

  it('does not announce audio consumer twice across context_lost -> ready bounce', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => {},
      },
    });
    const onAudio = vi.fn();

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component
          width={400}
          height={720}
          embodied
          onAudioConsumerReady={onAudio}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAudio).toHaveBeenCalledTimes(1);

    const canvas = result!.getByTestId('r3f-canvas') as HTMLCanvasElement;
    await act(async () => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await Promise.resolve();
      // Browser auto-recovery dispatches webglcontextrestored before our
      // 1500ms timer fires, returning the surface to `ready`.
      canvas.dispatchEvent(new Event('webglcontextrestored'));
      await Promise.resolve();
    });

    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('ready');
    // Sink must not be re-registered on bounce-back.
    expect(onAudio).toHaveBeenCalledTimes(1);
  });

  it('renders null when the runtime ends in failed_closed', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: {
        loaderOverride: async () => {
          throw new Error('asset_missing');
        },
      },
    });
    const evidence = vi.fn();

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component
          width={400}
          height={720}
          embodied
          onLifecycleEvidence={evidence}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result!.container.firstChild).toBeNull();
    expect(evidence).toHaveBeenCalledWith(
      'failed_closed',
      expect.objectContaining({ reason: 'load_failed' }),
    );
  });

  it('shutdown() can be called from the handle without error', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
      },
    });
    expect(() => handle.shutdown()).not.toThrow();
  });
});
