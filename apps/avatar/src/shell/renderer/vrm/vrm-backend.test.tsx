// Wave 1 (step 5) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Verifies the VRM dev-preview branch toggle:
//   * default mode keeps `metadata().mode === 'degraded_fail_closed'`
//     and the surface returns null (no user-visible carrier);
//   * dev-preview mode (`VITE_AVATAR_DEV_VRM_PREVIEW = 'true'`) flips
//     the metadata mode + mounts the placeholder element + emits
//     `dev_preview_mounted` lifecycle evidence.
//
// `import.meta.env` is mutated in-place so the change is visible to
// the freshly imported `vrm-backend.ts` module (Vite normally
// statically replaces this read at build time; vitest exposes
// `import.meta.env` as a writable object so per-test overrides work).

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VrmAvatarModelManifest } from '../carrier/model-resolver.js';

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

describe('VRM backend dev-preview toggle', () => {
  it('keeps degraded_fail_closed mode when VITE_AVATAR_DEV_VRM_PREVIEW is unset', async () => {
    delete (import.meta.env as Record<string, unknown>).VITE_AVATAR_DEV_VRM_PREVIEW;
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const handle = await createVrmBackendBranch(vrmManifest());
    expect(handle.branch.kind).toBe('vrm');
    expect(handle.branch.metadata()).toEqual(
      expect.objectContaining({ mode: 'degraded_fail_closed' }),
    );
    const Component = handle.branch.surface.Component;
    const evidence = vi.fn();
    const { container } = render(
      <Component
        width={400}
        height={720}
        embodied
        onLifecycleEvidence={evidence}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(evidence).toHaveBeenCalledWith(
      'failed_closed',
      expect.objectContaining({ reason: 'vrm_backend_default_mode_degraded' }),
    );
  });

  it('mounts dev preview placeholder when VITE_AVATAR_DEV_VRM_PREVIEW=true', async () => {
    (import.meta.env as Record<string, unknown>).VITE_AVATAR_DEV_VRM_PREVIEW = 'true';
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const handle = await createVrmBackendBranch(vrmManifest());
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
