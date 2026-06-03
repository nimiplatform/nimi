// Wave 2 chunk 2-C of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Verifies the VRM backend branch factory:
//   * default mode flips metadata.mode to `real_render` and the surface
//     mounts the real BackendBranch surface (Canvas + lifecycle wiring),
//     replacing the wave_1 step_5 dev-preview placeholder;
//   * dev-preview mode (`VITE_AVATAR_DEV_VRM_PREVIEW = 'true'`) keeps
//     `metadata().mode === 'dev_preview'` and mounts the placeholder
//     element (preserves wave_1 step_5 acceptance_invariant for the
//     opt-in debug flag).
//
// `import.meta.env` is mutated in-place so the change is visible to the
// freshly imported `vrm-backend.tsx` module (Vite normally statically
// replaces this read at build time; vitest exposes `import.meta.env` as a
// writable object so per-test overrides work).

import { act, render } from '@testing-library/react';
import type { VRM } from '@pixiv/three-vrm';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VrmAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';

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
    expect(evidence).toHaveBeenCalledWith(
      'load_started',
      expect.objectContaining({ source: 'vrm-carrier-surface' }),
    );
  });

  it('mounts dev preview placeholder when VITE_AVATAR_DEV_VRM_PREVIEW=true', async () => {
    (import.meta.env as Record<string, unknown>).VITE_AVATAR_DEV_VRM_PREVIEW = 'true';
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const handle = await createVrmBackendBranch(vrmManifest(), {
      loadProfileOverride: async () => null,
    });
    expect(handle.branch.metadata()).toEqual(
      expect.objectContaining({ mode: 'dev_preview' }),
    );
    const Component = handle.branch.surface.Component;
    const evidence = vi.fn();
    const { getByTestId } = render(
      <Component
        width={400}
        height={720}
        embodied
        onLifecycleEvidence={evidence}
      />,
    );
    const node = getByTestId('avatar-vrm-dev-preview');
    expect(node.getAttribute('data-avatar-vrm-dev-preview-mode')).toBe('placeholder');
    expect(node.textContent).toContain('avatar-sample');
    expect(evidence).toHaveBeenCalledWith(
      'dev_preview_mounted',
      expect.objectContaining({
        source: 'vrm-dev-preview-surface',
        vrm_file: '/models/sample/runtime/avatar.vrm',
      }),
    );
  });
});
