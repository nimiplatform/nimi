// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Verifies the VRM BackendBranch surface (vrm-carrier-surface.tsx). Uses
// the runtime's loaderOverride seam to feed a stub VRM, and stubs out
// `@react-three/fiber` Canvas so jsdom can mount the surface without a
// real WebGL context.

import { act, render } from '@testing-library/react';
import type { VRM } from '@pixiv/three-vrm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import type { BackendAudioConsumer } from '@nimiplatform/kit/features/avatar/headless';
import type { BackendProjection } from '../carrier/backend-branch.js';
import type { VrmEmoteState } from './vrm-emote-state.js';
import type { VrmGeneratedMotionRuntime } from './vrm-generated-motion-contract.js';
import type { VrmLipsyncDriver } from './vrm-lipsync-driver.js';
import type { ActivityMapping } from './vrm-projection-adapter.js';
import { createVrmRenderTarget } from './vrm-render-target.js';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';

const r3fScene = vi.hoisted(() => ({
  onAfterRender: undefined as ((...args: unknown[]) => void) | undefined,
}));

function renderVisibleFrame(input: { calls?: number; triangles?: number } = {}): void {
  r3fScene.onAfterRender?.({
    getRenderTarget: () => null,
    info: { render: { calls: input.calls ?? 1, triangles: input.triangles ?? 2 } },
  }, r3fScene);
}

function renderOffscreenFrame(): void {
  r3fScene.onAfterRender?.({
    getRenderTarget: () => ({}),
    info: { render: { calls: 1, triangles: 2 } },
  }, r3fScene);
}

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
  // in try/catch and the surface tests cover render recovery, not the probe.
  useThree: () => ({
    gl: {},
    scene: r3fScene,
    camera: {
      position: { set() {} },
      lookAt() {},
      updateProjectionMatrix() {},
      near: 0.1,
      far: 100,
      fov: 30,
    },
    invalidate() {},
  }),
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
    snapshot: () => ({
      attached: false,
      activeRouteId: null,
      activeLoop: false,
      activeInput: null,
      fadeRemainingSec: 0,
    }),
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
  resetProjectionAdapter: () => void;
  renderTarget: ReturnType<typeof createVrmRenderTarget>;
} {
  return {
    emoteState: emoteStateStub(),
    generatedMotionRuntime: generatedMotionRuntimeStub(),
    lipsyncDriver: lipsyncDriverStub(),
    activityMapping: activityMappingStub(),
    setProjectionAdapter: () => {},
    resetProjectionAdapter: () => {},
    // Wave 4 chunk 4-C: stub render target keeps the surface test fast +
    // jsdom-friendly. Tier C (default in jsdom — no WebGL renderer string)
    // means the alpha-mask probe is skipped and the hit region is bbox-only.
    renderTarget: createVrmRenderTarget({ stubMode: true }),
  };
}

function stubVrm(): VRM {
  const scene = new Group();
  const body = new Mesh(
    new BoxGeometry(0.6, 1.8, 0.3),
    new MeshBasicMaterial(),
  );
  body.position.y = 0.9;
  scene.add(body);
  return {
    scene,
    humanoid: { getNormalizedBoneNode: () => null },
  } as unknown as VRM;
}

function invalidGeometryVrm(): VRM {
  return { scene: new Group() } as unknown as VRM;
}

beforeEach(() => {
  vi.resetModules();
  r3fScene.onAfterRender = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createVrmCarrierSurface', () => {
  it('requires semantic renderable scene output and positive renderer work for first-frame readiness', async () => {
    const {
      hasVisibleRenderableVrmScene,
      isVrmSemanticFirstFrame,
    } = await import('./vrm-carrier-surface.js');
    const vrm = stubVrm();
    expect(hasVisibleRenderableVrmScene(vrm)).toBe(true);
    expect(isVrmSemanticFirstFrame({
      vrm,
      renderer: {
        getRenderTarget: () => null,
        info: { render: { calls: 1, triangles: 2 } },
      },
      renderedScene: r3fScene,
      expectedScene: r3fScene,
    })).toBe(true);
    expect(isVrmSemanticFirstFrame({
      vrm,
      renderer: {
        getRenderTarget: () => null,
        info: { render: { calls: 1, triangles: 0 } },
      },
      renderedScene: r3fScene,
      expectedScene: r3fScene,
    })).toBe(false);

    const mesh = (vrm.scene as unknown as {
      children: Array<{ material: { opacity: number } }>;
    }).children[0]!;
    mesh.material.opacity = 0;
    expect(hasVisibleRenderableVrmScene(vrm)).toBe(false);
  });

  it('publishes projected hit changes only after an accumulated two-pixel edge delta', async () => {
    const { hasMaterialProjectedHitChange } = await import('./vrm-carrier-surface.js');
    const previous = {
      body: { left: 0.25, top: 0.2, right: 0.75, bottom: 0.8 },
      drag: { left: 0.25, top: 0.2, right: 0.75, bottom: 0.8 },
      source: 'scene_geometry' as const,
      reasonCode: null,
    };
    expect(hasMaterialProjectedHitChange({
      previous,
      next: {
        ...previous,
        body: { ...previous.body, left: 0.252 },
        drag: { ...previous.drag, left: 0.252 },
      },
      viewportWidth: 400,
      viewportHeight: 720,
    })).toBe(false);
    expect(hasMaterialProjectedHitChange({
      previous,
      next: {
        ...previous,
        body: { ...previous.body, left: 0.255 },
        drag: { ...previous.drag, left: 0.255 },
      },
      viewportWidth: 400,
      viewportHeight: 720,
    })).toBe(true);
  });

  it('skips offscreen alpha capture for the Tier C bbox fallback', async () => {
    const { shouldCaptureVrmAlphaMask } = await import('./vrm-carrier-surface.js');
    expect(shouldCaptureVrmAlphaMask('C')).toBe(false);
    expect(shouldCaptureVrmAlphaMask('A')).toBe(true);
    expect(shouldCaptureVrmAlphaMask('B')).toBe(true);
  });

  it('withholds presentation ready until the current VRM produces a real render callback', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const onAudio = vi.fn();
    const onRegion = vi.fn();
    const onSurfaceBounds = vi.fn();
    const onPresentation = vi.fn();
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
          onAudioConsumerReady={onAudio}
          onHitRegionChange={onRegion}
          onSurfaceBoundsChange={onSurfaceBounds}
          onPresentationStateChange={onPresentation}
        />,
      );
      // Flush the async loader microtasks.
      await Promise.resolve();
      await Promise.resolve();
    });

    const root = result!.getByTestId('avatar-vrm-carrier');
    expect(root.getAttribute('data-avatar-vrm-state')).toBe('loading');
    expect(root.getAttribute('data-avatar-vrm-runtime-state')).toBe('ready');
    expect(result!.getByTestId('r3f-canvas')).toBeTruthy();

    await act(async () => {
      renderOffscreenFrame();
      await Promise.resolve();
    });
    expect(root.getAttribute('data-avatar-vrm-state')).toBe('loading');

    await act(async () => {
      renderVisibleFrame({ triangles: 0 });
      await Promise.resolve();
    });
    expect(root.getAttribute('data-avatar-vrm-state')).toBe('loading');

    await act(async () => {
      renderVisibleFrame();
      await Promise.resolve();
    });

    expect(root.getAttribute('data-avatar-vrm-state')).toBe('ready');
    expect(root.getAttribute('data-avatar-vrm-capability-profile-ref')).toBe(
      'avatar.vrm.capability-profile:vrm-avatar-capability-profile-v1',
    );

    // Audio consumer announced exactly once.
    expect(onAudio).toHaveBeenCalledTimes(1);

    // Tier-C precision degrades to the current scene-derived rectangle; it
    // does not make the entire transparent window draggable.
    expect(onRegion).toHaveBeenCalledTimes(1);
    const region = onRegion.mock.calls[0]?.[0];
    expect(region?.body.left).toBeGreaterThan(0);
    expect(region?.body.right).toBeLessThan(1);
    expect(region?.drag).toEqual(region?.body);
    expect(region?.isOpaqueAtClientPoint).toBeNull();
    expect(onSurfaceBounds).toHaveBeenCalledWith(expect.objectContaining({
      source: 'scene_geometry',
      reasonCode: null,
    }));
    expect(onPresentation.mock.calls.map(([state]) => state.kind)).toEqual(['loading', 'ready']);
  });

  it('fails closed when the exact current VRM never produces a visible frame', async () => {
    vi.useFakeTimers();
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const { VRM_PRESENTATION_WATCHDOG_TIMEOUT_MS } = await import('./vrm-runtime.js');
    const onPresentation = vi.fn();
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: { loaderOverride: async () => stubVrm() },
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component
          width={400}
          height={720}
          embodied
          onPresentationStateChange={onPresentation}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'))
      .toBe('loading');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VRM_PRESENTATION_WATCHDOG_TIMEOUT_MS);
    });

    expect(result!.getByTestId('avatar-presentation-unavailable')).toBeTruthy();
    expect(onPresentation).toHaveBeenLastCalledWith({
      kind: 'unavailable',
      reason: 'visible_first_frame_timed_out',
    });
  });

  it('uses the configured bounds fallback but publishes an invalid non-draggable region', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const onRegion = vi.fn();
    const onSurfaceBounds = vi.fn();
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: { loaderOverride: async () => invalidGeometryVrm() },
    });

    await act(async () => {
      render(
        <handle.Component
          width={400}
          height={720}
          embodied
          onHitRegionChange={onRegion}
          onSurfaceBoundsChange={onSurfaceBounds}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSurfaceBounds).toHaveBeenCalledWith(expect.objectContaining({
      source: 'configured_fallback',
      reasonCode: 'scene_geometry_unavailable',
    }));
    expect(onRegion).toHaveBeenCalledWith({
      body: { left: 0, top: 0, right: 0, bottom: 0 },
      drag: { left: 0, top: 0, right: 0, bottom: 0 },
      isOpaqueAtClientPoint: null,
    });
  });

  it('retains the last valid projected rectangle when a later geometry sample is invalid', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const currentVrm = stubVrm();
    const onRegion = vi.fn();
    const onSurfaceBounds = vi.fn();
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: { loaderOverride: async () => currentVrm },
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component
          width={400}
          height={720}
          embodied
          onHitRegionChange={onRegion}
          onSurfaceBoundsChange={onSurfaceBounds}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const validRegion = onRegion.mock.calls.at(-1)?.[0];
    expect(validRegion.body.right).toBeGreaterThan(validRegion.body.left);
    expect(onSurfaceBounds).toHaveBeenCalledTimes(1);

    (currentVrm.scene as unknown as { clear(): void }).clear();
    await act(async () => {
      result!.rerender(
        <handle.Component
          width={401}
          height={720}
          embodied
          onHitRegionChange={onRegion}
          onSurfaceBoundsChange={onSurfaceBounds}
        />,
      );
      await Promise.resolve();
    });

    expect(onRegion).toHaveBeenCalledTimes(1);
    expect(onSurfaceBounds).toHaveBeenCalledTimes(1);
    expect(onRegion.mock.calls.at(-1)?.[0]).toBe(validRegion);
  });

  it('webglcontextlost on canvas drives the runtime through context_lost', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const extras = commonExtras();
    const resetProjectionAdapter = vi.fn();
    const disposeMotion = vi.spyOn(extras.generatedMotionRuntime, 'dispose');
    const consumer = audioConsumer();
    const silenceAudio = vi.spyOn(consumer, 'silent');
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: consumer,
      ...extras,
      resetProjectionAdapter,
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
        // Capture the timer so the test deterministically holds the
        // machine in `context_lost` (no spontaneous retry firing).
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => {},
      },
    });
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      renderVisibleFrame();
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
    ).toBe('recovering');
    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-runtime-state'),
    ).toBe('context_lost');
    expect(resetProjectionAdapter).toHaveBeenCalled();
    expect(disposeMotion).toHaveBeenCalled();
    expect(silenceAudio).toHaveBeenCalled();
  });

  it('suspends active ambient motion and restores it when reduced motion is disabled', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const extras = commonExtras();
    const stopAll = vi.spyOn(extras.generatedMotionRuntime, 'stopAll');
    const play = vi.spyOn(extras.generatedMotionRuntime, 'play');
    vi.spyOn(extras.generatedMotionRuntime, 'snapshot').mockReturnValue({
      attached: true,
      activeRouteId: 'idle_subtle',
      activeLoop: true,
      activeInput: {
        routeId: 'idle_subtle',
        loop: true,
        intensity: 0.65,
        fade: 0.15,
      },
      fadeRemainingSec: 0,
    });
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...extras,
      runtimeOptions: { loaderOverride: async () => stubVrm() },
    });
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component width={400} height={720} embodied reducedMotion={false} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    stopAll.mockClear();

    await act(async () => {
      result!.rerender(
        <handle.Component width={400} height={720} embodied reducedMotion />,
      );
      await Promise.resolve();
    });

    expect(stopAll).toHaveBeenCalledTimes(1);

    await act(async () => {
      result!.rerender(
        <handle.Component width={400} height={720} embodied reducedMotion={false} />,
      );
      await Promise.resolve();
    });

    expect(play).toHaveBeenCalledWith({
      routeId: 'idle_subtle',
      loop: true,
      intensity: 0.65,
      fade: 0.15,
    });
  });

  it('does not announce audio consumer twice across context_lost -> mandatory retry reload', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    let retryHandler: (() => void) | null = null;
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
      ...commonExtras(),
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
        setTimeoutFn: (handler) => {
          retryHandler = handler;
          return 1;
        },
        clearTimeoutFn: () => {
          retryHandler = null;
        },
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
      canvas.dispatchEvent(new Event('webglcontextrestored'));
      await Promise.resolve();
    });
    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('recovering');

    await act(async () => {
      retryHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('loading');
    await act(async () => {
      renderVisibleFrame();
      await Promise.resolve();
    });

    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('ready');
    // Sink must not be re-registered on bounce-back.
    expect(onAudio).toHaveBeenCalledTimes(1);
  });

  it('renders the local unavailable surface when the runtime ends in failed_closed', async () => {
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
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <handle.Component
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result!.getByTestId('avatar-presentation-unavailable')).toBeTruthy();
    expect(result!.getByText('load_failed')).toBeTruthy();
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
