// Wave 1 of topic 2026-04-30-avatar-vrm-backend-branch (design-02 §"VRM
// Backend 文件骨架"); step_5 admits the dev-only preview branch.
//
// Default product mode (`VITE_AVATAR_DEV_VRM_PREVIEW !== 'true'`):
// - surface.Component returns null — no user-visible carrier
// - projection methods are no-ops
// - lifecycle evidence reports `failed_closed` so embodiment-stage
//   records the degraded path
// - metadata().mode === 'degraded_fail_closed'
//
// Dev preview mode (`VITE_AVATAR_DEV_VRM_PREVIEW === 'true'`; only
// admitted in non-production builds via Vite env): mounts the
// placeholder surface from `vrm-dev-preview-surface.tsx`. This proves
// the BackendBranch surface mount + lifecycle callback flow without
// pulling in @pixiv/three-vrm runtime; metadata().mode flips to
// `dev_preview` and lifecycle evidence carries `dev_preview_mounted`.

import type { ComponentType } from 'react';
import { useEffect } from 'react';
import type { VrmAvatarModelManifest } from '../carrier/model-resolver.js';
import type {
  BackendAudioConsumer,
  BackendBranch,
  BackendNominalBounds,
  BackendProjection,
  BackendSurface,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';
import { createVrmDevPreviewSurfaceComponent } from './vrm-dev-preview-surface.js';

const VRM_NOMINAL_BOUNDS: BackendNominalBounds = Object.freeze({
  width: 400,
  height: 720,
  bodyCenterX: 0.5,
  bodyCenterY: 0.55,
});

type VrmRuntimeMode = 'degraded_fail_closed' | 'dev_preview';

function readDevPreviewFlag(env: Record<string, unknown> | undefined): boolean {
  if (!env) return false;
  const raw = env['VITE_AVATAR_DEV_VRM_PREVIEW'];
  return raw === 'true' || raw === true;
}

function resolveRuntimeMode(): VrmRuntimeMode {
  // `import.meta.env` is statically replaced by Vite at build time;
  // accessing it through an indirection keeps the read testable
  // (jsdom test runs without Vite-bundled env).
  const meta = (import.meta as unknown as { env?: Record<string, unknown> });
  return readDevPreviewFlag(meta.env) ? 'dev_preview' : 'degraded_fail_closed';
}

function createVrmDegradedSurface(): BackendSurface {
  const Component: ComponentType<BackendSurfaceProps> = (props) => {
    useEffect(() => {
      props.onLifecycleEvidence?.('failed_closed', {
        reason: 'vrm_backend_default_mode_degraded',
        source: 'vrm-backend.ts',
      });
    }, [props.onLifecycleEvidence]);
    return null;
  };
  return { Component };
}

function createVrmProjectionStub(): BackendProjection {
  return {
    applyActivity() {},
    applyEmotion() {},
    applyMotion() {},
    applyExpression() {},
    reset() {},
  };
}

function createVrmAudioConsumerStub(): BackendAudioConsumer {
  return {
    async attachAudioSource() {},
    detachAudioSource() {},
    silent() {},
    snapshot() {
      return null;
    },
  };
}

export type VrmBackendBranchHandle = {
  branch: BackendBranch & { kind: 'vrm' };
  audioConsumer: BackendAudioConsumer;
  shutdown(): void;
};

export async function createVrmBackendBranch(
  manifest: VrmAvatarModelManifest,
): Promise<VrmBackendBranchHandle> {
  const mode = resolveRuntimeMode();
  const audioConsumer = createVrmAudioConsumerStub();
  const surface: BackendSurface =
    mode === 'dev_preview'
      ? { Component: createVrmDevPreviewSurfaceComponent({ manifest }) }
      : createVrmDegradedSurface();
  const branch: BackendBranch & { kind: 'vrm' } = {
    kind: 'vrm',
    nominalBounds: VRM_NOMINAL_BOUNDS,
    projection: createVrmProjectionStub(),
    surface,
    metadata: () => ({
      model_kind: 'vrm',
      mode,
      vrm_file: manifest.vrm.vrmFile,
      motion_presets_dir: manifest.vrm.motionPresetsDir,
    }),
    shutdown() {},
  };
  return {
    branch,
    audioConsumer,
    shutdown: branch.shutdown,
  };
}
