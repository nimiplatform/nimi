// Contract tests for .nimi/spec/avatar/kernel/vrm-backend-contract.md.
//
// Verifies the VRM backend branch factory:
//   * default mode flips metadata.mode to `real_render` and the surface
//     mounts the real BackendBranch surface (Canvas + lifecycle wiring),
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
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => (
    <div data-testid="r3f-canvas-mock">
      <canvas data-testid="r3f-canvas" />
      {children}
    </div>
  ),
  // No-op useFrame in jsdom — chunk 3-D wires a per-frame tick chain
  // inside <Canvas>, but the unit tests rely on the runtime lifecycle
  // state, not on RAF.
  useFrame: () => {},
  // Wave 4 chunk 4-C: VrmRenderTargetCaptureLoop reads gl/scene/camera
  // through useThree for the per-tick capture(). Stubs are fine — the
  // capture is wrapped in try/catch, and the alpha-mask probe only
  // matters in real-WebGL builds.
  useThree: () => ({ gl: {}, scene: {}, camera: {} }),
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
  return { scene: { traverse() {} } } as unknown as VRM;
}

const ORIGINAL_FLAG = (import.meta.env as Record<string, unknown>)
  .VITE_AVATAR_DEV_VRM_PREVIEW;

beforeEach(() => {
  vi.resetModules();
});

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
    const evidence = vi.fn();

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <Component
          width={400}
          height={720}
          embodied
          onLifecycleEvidence={evidence}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Real surface mounts a canvas-rooted carrier shell.
    const carrier = result!.getByTestId('avatar-vrm-carrier');
    expect(carrier.getAttribute('data-avatar-vrm-state')).toBe('ready');
    expect(result!.getByTestId('r3f-canvas')).toBeTruthy();
    expect(evidence).not.toHaveBeenCalledWith('load_failed', expect.anything());
    expect(evidence).not.toHaveBeenCalledWith('context_lost', expect.anything());
    expect(evidence).not.toHaveBeenCalledWith('failed_closed', expect.anything());
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
    const evidence = vi.fn();
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <Component
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
    expect(result!.getByTestId('r3f-canvas')).toBeTruthy();
    expect(evidence).not.toHaveBeenCalledWith('load_failed', expect.anything());
    expect(evidence).not.toHaveBeenCalledWith('context_lost', expect.anything());
    expect(evidence).not.toHaveBeenCalledWith('failed_closed', expect.anything());
  });
});
