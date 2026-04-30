// Wave 2 chunk 2-C of topic 2026-04-30-avatar-vrm-backend-branch.
//
// VRM BackendBranch factory. Wave 2 replaces the wave_1 step_5 dev-preview
// placeholder with the real @react-three/fiber Canvas + VrmRuntime
// lifecycle surface (see vrm-carrier-surface.tsx).
//
// Default product mode (`VITE_AVATAR_DEV_VRM_PREVIEW !== 'true'`):
// - surface.Component is the real BackendBranch surface — drives the
//   VrmRuntime lifecycle, mounts <Canvas> + <VrmScene>, forwards
//   onAudioConsumerReady / onHitRegionChange / onLifecycleEvidence
// - metadata().mode === 'real_render'
//
// Dev preview mode (`VITE_AVATAR_DEV_VRM_PREVIEW === 'true'`; non-prod
// builds only): mounts the placeholder surface from
// `vrm-dev-preview-surface.tsx` for debugging without spinning up the
// real Three.js renderer. metadata().mode === 'dev_preview'.

import type { ComponentType } from 'react';
import { useEffect } from 'react';
import type { VrmAvatarModelManifest } from '../carrier/model-resolver.js';
import type {
  BackendAudioConsumer,
  BackendBranch,
  BackendProjection,
  BackendSurface,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';
import { createVrmCarrierSurface } from './vrm-carrier-surface.js';
import { createVrmDevPreviewSurfaceComponent } from './vrm-dev-preview-surface.js';
import { VRM_DEFAULT_NOMINAL_BOUNDS } from './vrm-nominal-bounds.js';
import type { VrmRuntimeOptions } from './vrm-runtime.js';

// Wave 2 chunk 2-E: nominalBounds is the BOOT placeholder used by
// embodiment-stage for the very first window-resize tick (before VRM
// scene bbox is known). Per backend-branch-contract.md §2.9 this is a
// static field; per-frame post-load truth flows through
// onHitRegionChange (carrier surface). VRM_DEFAULT_NOMINAL_BOUNDS is
// sourced from window-bounds-policy.yaml backends.vrm (360x720 +
// bottom-companion default bodyCenterY=0.55).

type VrmRuntimeMode = 'real_render' | 'dev_preview';

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
  return readDevPreviewFlag(meta.env) ? 'dev_preview' : 'real_render';
}

function createVrmDevPreviewBackendSurface(manifest: VrmAvatarModelManifest): BackendSurface {
  const Component: ComponentType<BackendSurfaceProps> = createVrmDevPreviewSurfaceComponent({
    manifest,
  });
  // Wrap so dev-preview surface still emits a transparent ack effect that
  // mirrors the real surface's `load_started` evidence shape, keeping
  // embodiment-stage behaviour comparable across the two paths.
  const Wrapper: ComponentType<BackendSurfaceProps> = (props) => {
    useEffect(() => {
      props.onLifecycleEvidence?.('dev_preview_active', {
        source: 'vrm-backend.ts',
        vrm_file: manifest.vrm.vrmFile,
      });
    }, [props.onLifecycleEvidence]);
    return <Component {...props} />;
  };
  return { Component: Wrapper };
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

export type CreateVrmBackendBranchOptions = {
  /** Test seam forwarded to createVrmRuntime via createVrmCarrierSurface. */
  runtimeOptions?: Pick<
    VrmRuntimeOptions,
    'loaderOverride' | 'setTimeoutFn' | 'clearTimeoutFn' | 'nowFn'
  >;
};

export async function createVrmBackendBranch(
  manifest: VrmAvatarModelManifest,
  options: CreateVrmBackendBranchOptions = {},
): Promise<VrmBackendBranchHandle> {
  const mode = resolveRuntimeMode();
  const audioConsumer = createVrmAudioConsumerStub();

  let surface: BackendSurface;
  let surfaceShutdown: () => void = () => {};
  if (mode === 'dev_preview') {
    surface = createVrmDevPreviewBackendSurface(manifest);
  } else {
    const handle = createVrmCarrierSurface({
      manifest,
      audioConsumer,
      runtimeOptions: options.runtimeOptions,
    });
    surface = { Component: handle.Component };
    surfaceShutdown = handle.shutdown;
  }

  const branch: BackendBranch & { kind: 'vrm' } = {
    kind: 'vrm',
    nominalBounds: VRM_DEFAULT_NOMINAL_BOUNDS,
    projection: createVrmProjectionStub(),
    surface,
    metadata: () => ({
      model_kind: 'vrm',
      mode,
      vrm_file: manifest.vrm.vrmFile,
      motion_presets_dir: manifest.vrm.motionPresetsDir,
    }),
    shutdown() {
      surfaceShutdown();
    },
  };
  return {
    branch,
    audioConsumer,
    shutdown() {
      branch.shutdown();
    },
  };
}
