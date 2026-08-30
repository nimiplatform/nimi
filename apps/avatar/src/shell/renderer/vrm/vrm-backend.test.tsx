// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Verifies the VRM backend branch factory:
//   * default mode flips metadata.mode to `real_render` and the surface
//     mounts the real BackendBranch surface (Canvas + render/recovery wiring),
//     with no dev-preview placeholder;
//   * VITE_AVATAR_DEV_VRM_PREVIEW is ignored by the product backend and
//     cannot select a placeholder success branch.
//
// `import.meta.env` is mutated in-place so the change is visible to the
// freshly imported `vrm-backend.tsx` module (Vite normally statically
// replaces this read at build time; vitest exposes `import.meta.env` as a
// writable object so per-test overrides work).

import { act, render } from '@testing-library/react';
import type { VRM } from '@pixiv/three-vrm';
import type { Profile } from 'wlipsync';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';

const r3fScene = vi.hoisted(() => ({
  onAfterRender: undefined as ((...args: unknown[]) => void) | undefined,
}));

function renderVisibleFrame(): void {
  r3fScene.onAfterRender?.({
    getRenderTarget: () => null,
    info: { render: { calls: 1, triangles: 2 } },
  }, r3fScene);
}

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => (
    <div data-testid="r3f-canvas-mock">
      <canvas data-testid="r3f-canvas" />
      {children}
    </div>
  ),
  // No-op useFrame in jsdom — chunk 3-D wires a per-frame tick chain
  // inside <Canvas>, but the unit tests rely on the backend-local render state
  // state, not on RAF.
  useFrame: () => {},
  // Wave 4 chunk 4-C: VrmRenderTargetCaptureLoop reads gl/scene/camera
  // through useThree for the per-tick capture(). Stubs are fine — the
  // capture is wrapped in try/catch, and the alpha-mask probe only
  // matters in real-WebGL builds.
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

function vrmManifest(): VrmAvatarModelManifest {
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

function stubVrm(): VRM {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(0.6, 1.8, 0.3), new MeshBasicMaterial({ opacity: 1 })));
  return {
    scene,
    humanoid: { getNormalizedBoneNode: () => ({ name: 'bone' }) },
    expressionManager: { expressionMap: { happy: {}, aa: {} } },
    lookAt: {},
  } as unknown as VRM;
}

function stubLipsyncProfile(): Profile {
  return { mfcc: [], visemes: [] } as unknown as Profile;
}

const ORIGINAL_FLAG = (import.meta.env as Record<string, unknown>)
  .VITE_AVATAR_DEV_VRM_PREVIEW;

beforeEach(() => {
  vi.resetModules();
  r3fScene.onAfterRender = undefined;
});

async function completeFirstFrame(): Promise<void> {
  await act(async () => {
    renderVisibleFrame();
    await Promise.resolve();
  });
}

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete (import.meta.env as Record<string, unknown>).VITE_AVATAR_DEV_VRM_PREVIEW;
  } else {
    (import.meta.env as Record<string, unknown>).VITE_AVATAR_DEV_VRM_PREVIEW = ORIGINAL_FLAG;
  }
});

describe('VRM backend branch (chunk 2-C)', () => {
  it('default mode mounts the real BackendBranch surface and reports mode=real_render', async () => {
    delete (import.meta.env as Record<string, unknown>).VITE_AVATAR_DEV_VRM_PREVIEW;
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const handle = await createVrmBackendBranch(vrmManifest(), {
      runtimeOptions: { loaderOverride: async () => stubVrm() },
      loadProfileOverride: async () => null,
    });
    expect(handle.branch.kind).toBe('vrm');
    expect(handle.branch.metadata()).toEqual(
      expect.objectContaining({ mode: 'real_render' }),
    );

    const Component = handle.branch.surface.Component;

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <Component
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await completeFirstFrame();

    // Real surface mounts a canvas-rooted carrier shell.
    const carrier = result!.getByTestId('avatar-vrm-carrier');
    expect(carrier.getAttribute('data-avatar-vrm-state')).toBe('ready');
    expect(result!.getByTestId('r3f-canvas')).toBeTruthy();
  });

  it('publishes the loaded typed capability profile and bounded lipsync facts for the carrier', async () => {
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const handle = await createVrmBackendBranch(vrmManifest(), {
      runtimeOptions: { loaderOverride: async () => stubVrm() },
      loadProfileOverride: async () => stubLipsyncProfile(),
    });
    const Component = handle.branch.surface.Component;
    await act(async () => {
      render(<Component width={400} height={720} embodied />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const facts = handle.branch.debugFacts?.();
    expect(facts).toMatchObject({
      kind: 'vrm',
      lipsyncProfilePresent: true,
      capabilityProfile: {
        profileId: 'vrm-avatar-capability-profile-v1',
        backendKind: 'vrm',
        expressionManagerPresent: true,
        generatedMotion: {
          unsupportedRoutes: [],
        },
      },
    });
    if (facts?.kind !== 'vrm') throw new Error('expected VRM debug facts');
    expect(facts.capabilityProfile?.generatedMotion.supportedRoutes).toEqual([
      'idle_subtle', 'listen_lean', 'nod_yes', 'shake_no', 'greet_wave',
    ]);
  });

  it('ignores VITE_AVATAR_DEV_VRM_PREVIEW and mounts the real backend surface', async () => {
    (import.meta.env as Record<string, unknown>).VITE_AVATAR_DEV_VRM_PREVIEW = 'true';
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const handle = await createVrmBackendBranch(vrmManifest(), {
      runtimeOptions: { loaderOverride: async () => stubVrm() },
      loadProfileOverride: async () => null,
    });
    expect(handle.branch.metadata()).toEqual(
      expect.objectContaining({ mode: 'real_render' }),
    );
    const Component = handle.branch.surface.Component;
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <Component
          width={400}
          height={720}
          embodied
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await completeFirstFrame();
    expect(result!.getByTestId('avatar-vrm-carrier').getAttribute('data-avatar-vrm-state')).toBe(
      'ready',
    );
    expect(result!.getByTestId('r3f-canvas')).toBeTruthy();
  });
});
