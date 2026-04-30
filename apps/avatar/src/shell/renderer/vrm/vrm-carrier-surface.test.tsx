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
import type { VrmAvatarModelManifest } from '../carrier/model-resolver.js';
import type { BackendAudioConsumer } from '../carrier/backend-branch.js';

vi.mock('@react-three/fiber', () => ({
  // Render a plain <canvas> wrapper so the surface's webglcontextlost
  // listener has a real EventTarget to bind to.
  Canvas: ({ children }: { children?: ReactNode }) => (
    <div data-testid="r3f-canvas-mock">
      <canvas data-testid="r3f-canvas" />
      {children}
    </div>
  ),
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
  it('mounts the canvas and reaches `ready` after the loader resolves', async () => {
    const { createVrmCarrierSurface } = await import('./vrm-carrier-surface.js');
    const evidence = vi.fn();
    const onAudio = vi.fn();
    const onRegion = vi.fn();
    const handle = createVrmCarrierSurface({
      manifest: manifest(),
      audioConsumer: audioConsumer(),
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
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
      },
    });
    expect(() => handle.shutdown()).not.toThrow();
  });
});
