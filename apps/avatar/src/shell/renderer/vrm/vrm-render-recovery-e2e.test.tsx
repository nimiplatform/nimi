// Presentation and backend-local recovery tests for Avatar VRM.
//
// End-to-end VRM render/recovery test that drives the full chain:
//
//     manifest -> createVrmBackendBranch -> vrm-carrier-surface ->
//     vrm-runtime -> loader (override seam)
//
// The mock fixture `vrm-render-recovery.mock.json` supplies the scenario;
// this test reads its manifest block and feeds it to the backend factory.
// The cached `.vrm` binary is gitignored and may not exist in CI, so we
// short-circuit the actual disk read via the runtime's `loaderOverride`.
//
// Covered product cases:
//
//   1. Initial load succeeds: stub loader resolves; the concrete surface is
//      present; onAudioConsumerReady fires once; backend metadata exposes
//      model_kind='vrm' + vrm_file (so the avatar.model.load event
//      emitted at the higher avatar-carrier layer carries vrm semantics).
//   2. Initial load failure: stub loader rejects and the Avatar window shows
//      the local unavailable surface.
//   3. Asset switch: mount manifest A, unmount, mount manifest B; loader
//      called once per mount (two distinct backend instances).
//   4. Context loss is retried entirely inside the backend.
//   5. A second context loss before recovery shows the local unavailable
//      surface with reason `context_lost_twice`.

import { act, render } from '@testing-library/react';
import type { VRM } from '@pixiv/three-vrm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import scenarioJson from '../mock/scenarios/vrm-render-recovery.mock.json';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';

vi.mock('@react-three/fiber', () => ({
  // Same Canvas mock pattern as vrm-carrier-surface.test.tsx — gives us
  // a real <canvas> EventTarget to dispatch webglcontextlost on.
  Canvas: ({ children }: { children?: ReactNode }) => (
    <div data-testid="r3f-canvas-mock">
      <canvas data-testid="r3f-canvas" />
      {children}
    </div>
  ),
  // No-op useFrame in jsdom (chunk 3-D mounts a per-frame tick chain
  // inside <Canvas>; render/recovery assertions don't depend on RAF).
  useFrame: () => {},
  // Wave 4 chunk 4-C: VrmRenderTargetCaptureLoop calls useThree to read
  // gl/scene/camera. Stubs are fine — the render/recovery assertions don't
  // depend on the alpha-mask probe.
  useThree: () => ({ gl: {}, scene: {}, camera: {} }),
}));

type ScenarioVrmRenderRecovery = {
  vrm_render_recovery: {
    model_manifest: VrmAvatarModelManifest;
    expected_evidence: string[];
    fixture_steps: Array<{ atMs: number; kind: string }>;
    human_acceptance_checks: string[];
  };
};

function manifestFromScenario(): VrmAvatarModelManifest {
  const data = scenarioJson as unknown as ScenarioVrmRenderRecovery;
  // Defensive copy so a test cannot mutate the imported JSON module.
  return JSON.parse(JSON.stringify(data.vrm_render_recovery.model_manifest));
}

function alternateManifest(): VrmAvatarModelManifest {
  // Distinct modelId + vrmFile so the runtime/loader treat this as a
  // different asset (cache miss, fresh load).
  return {
    kind: 'vrm',
    modelId: 'vrm1-constraint-twist-alt',
    runtimeDir: '.cache/assets/vrm-models',
    nimiDir: null,
    posterPath: null,
    vrm: {
      vrmFile: '.cache/assets/vrm-models/AvatarSample_A.vrm',
      motionPresetsDir: null,
    },
  };
}

function stubVrm(): VRM {
  return { scene: { traverse() {} } } as unknown as VRM;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('VRM render and recovery end-to-end (chunk 2-D)', () => {
  it('initial load renders the carrier, announces audio consumer, and exposes backend metadata with model_kind=vrm', async () => {
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const manifest = manifestFromScenario();

    const handle = await createVrmBackendBranch(manifest, {
      runtimeOptions: { loaderOverride: async () => stubVrm() },
      loadProfileOverride: async () => null,
    });

    // Backend metadata reflects vrm semantics — this is the surface the
    // avatar-carrier consumes when emitting `avatar.model.load`.
    const meta = handle.branch.metadata();
    expect(meta.model_kind).toBe('vrm');
    expect(meta.vrm_file).toBe(manifest.vrm.vrmFile);
    expect(handle.branch.kind).toBe('vrm');

    const Surface = handle.branch.surface.Component;
    const onAudio = vi.fn();
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <Surface
          width={400}
          height={720}
          embodied
          onAudioConsumerReady={onAudio}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const root = result!.getByTestId('avatar-vrm-carrier');
    expect(root.getAttribute('data-avatar-vrm-state')).toBe('ready');
    expect(onAudio).toHaveBeenCalledTimes(1);

    handle.shutdown();
  });

  it('initial load failure shows the local unavailable surface', async () => {
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const manifest = manifestFromScenario();

    const handle = await createVrmBackendBranch(manifest, {
      runtimeOptions: {
        loaderOverride: async () => {
          throw new Error('asset_missing');
        },
      },
      loadProfileOverride: async () => null,
    });

    const Surface = handle.branch.surface.Component;
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <Surface
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result!.getByTestId('avatar-presentation-unavailable').textContent).toContain('load_failed');

    handle.shutdown();
  });

  it('asset switch tears down prior backend and starts a new one with fresh loader call', async () => {
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const manifestA = manifestFromScenario();
    const manifestB = alternateManifest();
    const loaderCalls: string[] = [];

    const loaderOverride = async (m: VrmAvatarModelManifest): Promise<VRM> => {
      loaderCalls.push(m.modelId);
      return stubVrm();
    };

    const handleA = await createVrmBackendBranch(manifestA, {
      runtimeOptions: { loaderOverride },
    });
    const SurfaceA = handleA.branch.surface.Component;
    let resultA: ReturnType<typeof render>;
    await act(async () => {
      resultA = render(
        <SurfaceA
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      resultA!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('ready');
    resultA!.unmount();
    handleA.shutdown();

    const handleB = await createVrmBackendBranch(manifestB, {
      runtimeOptions: { loaderOverride },
    });
    const SurfaceB = handleB.branch.surface.Component;
    let resultB: ReturnType<typeof render>;
    await act(async () => {
      resultB = render(
        <SurfaceB
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      resultB!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('ready');

    // Loader called exactly once per backend instance (no shared cache
    // hit because each manifest has a distinct vrmFile).
    expect(loaderCalls).toEqual([manifestA.modelId, manifestB.modelId]);

    handleB.shutdown();
  });

  it('webglcontextlost recovers after the 1500ms retry', async () => {
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const manifest = manifestFromScenario();

    // Hand-rolled timer + clock so we can advance time deterministically
    // without using vi.useFakeTimers (which would also fake the
    // microtask-scheduling primitives used by act/render).
    const pending: Array<{ handler: () => void; ms: number }> = [];
    let virtualNow = 1000;
    const setTimeoutFn = (handler: () => void, ms: number) => {
      pending.push({ handler, ms });
      return pending.length - 1;
    };
    const clearTimeoutFn = () => {};
    const nowFn = () => virtualNow;

    const handle = await createVrmBackendBranch(manifest, {
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
        setTimeoutFn,
        clearTimeoutFn,
        nowFn,
      },
    });
    const Surface = handle.branch.surface.Component;
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <Surface
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('ready');

    // Inject webglcontextlost.
    const canvas = result!.getByTestId('r3f-canvas') as HTMLCanvasElement;
    await act(async () => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await Promise.resolve();
    });
    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('context_lost');

    // Advance virtual clock by 1500ms and fire the captured retry.
    virtualNow += 1500;
    await act(async () => {
      // Take the most recently-registered timer (the retry).
      const last = pending.pop();
      last?.handler();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('ready');

    handle.shutdown();
  });

  it('second webglcontextlost before retry fires escalates to failed_closed (context_lost_twice)', async () => {
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const manifest = manifestFromScenario();

    const handle = await createVrmBackendBranch(manifest, {
      runtimeOptions: {
        loaderOverride: async () => stubVrm(),
        // Hold the retry timer permanently — never fires, so we can stage
        // a second loss before recovery.
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => {},
      },
    });
    const Surface = handle.branch.surface.Component;
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <Surface
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('ready');

    const canvas = result!.getByTestId('r3f-canvas') as HTMLCanvasElement;
    await act(async () => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await Promise.resolve();
    });
    expect(
      result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state'),
    ).toBe('context_lost');

    // Second loss before retry timer fires.
    await act(async () => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await Promise.resolve();
    });

    expect(result!.getByTestId('avatar-presentation-unavailable').textContent).toContain('context_lost_twice');

    handle.shutdown();
  });

  it('mock fixture exposes the manifest the test consumes (catalog wiring sanity)', () => {
    const data = scenarioJson as unknown as ScenarioVrmRenderRecovery;
    expect(data.vrm_render_recovery.model_manifest.kind).toBe('vrm');
    expect(data.vrm_render_recovery.model_manifest.modelId).toBe('vrm1-constraint-twist');
  });
});

// Temporary context-loss and retry state stays backend-local. The user-visible
// contract begins only when recovery is exhausted and the unavailable view is shown.
