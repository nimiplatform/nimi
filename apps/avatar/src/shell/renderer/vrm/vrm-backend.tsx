// Wave 3 chunk 3-D of topic 2026-04-30-avatar-vrm-backend-branch.
//
// VRM BackendBranch factory. Wave 3 chunk 3-D rewires the wave_2 chunk
// 2-C scaffolding to the real chunk 3-A (emote state) + chunk 3-B
// (motion preset registry) + chunk 3-C (lipsync driver + projection
// adapter) + new vrm-audio-consumer. After this chunk the VRM backend
// is fully functional in code; differentiated `.vrma` motion assets
// remain deferred (D plan: only `idle_subtle.vrma` is admitted; other
// preset ids will fail to load via registry.failedIds and play() will
// return `{played: false, reason: 'preset_not_loaded'}` — a clean
// fail-close).
//
// Default product mode (`VITE_AVATAR_DEV_VRM_PREVIEW !== 'true'`):
// - surface.Component is the real BackendBranch surface — drives the
//   VrmRuntime lifecycle, mounts <Canvas> + <VrmScene>, and runs the
//   useFrame tick chain (lipsync driver → emote state → motion mixer
//   → vrm.update)
// - metadata().mode === 'real_render'
//
// Dev preview mode (`VITE_AVATAR_DEV_VRM_PREVIEW === 'true'`; non-prod
// builds only): mounts the placeholder surface from
// `vrm-dev-preview-surface.tsx` for debugging without spinning up the
// real Three.js renderer. metadata().mode === 'dev_preview'.
//
// Deferred projection shim:
//   At factory time the VRM instance does not exist yet — the projection
//   adapter requires a loaded VRM. We expose a thin shim implementing
//   BackendProjection that queues calls until the surface (post-runtime
//   `ready`) registers the real adapter. Pre-ready calls are replayed
//   on first `setAdapter`. If the runtime never reaches ready (failed_
//   closed), queued calls remain queued indefinitely — matches the
//   fail-close lifecycle (no projection delivery is correct).

import type { ComponentType } from 'react';
import { useEffect } from 'react';
import type { Profile } from 'wlipsync';
import type { VrmAvatarModelManifest } from '../carrier/model-resolver.js';
import type {
  BackendAudioConsumer,
  BackendBranch,
  BackendProjection,
  BackendSurface,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';
import { createActivityMappingResolver } from '../nas/activity-mapping-resolver.js';
import { createVrmCarrierSurface } from './vrm-carrier-surface.js';
import { createVrmDevPreviewSurfaceComponent } from './vrm-dev-preview-surface.js';
import { VRM_DEFAULT_NOMINAL_BOUNDS } from './vrm-nominal-bounds.js';
import type { VrmRuntimeOptions } from './vrm-runtime.js';
import { createVrmAudioConsumer } from './vrm-audio-consumer.js';
import { createVrmEmoteState } from './vrm-emote-state.js';
import { loadVrmEmoteTable } from './load-vrm-emote-table.js';
import { createVrmMotionPresetRegistry } from './vrm-motion-preset-registry.js';
import { loadVrmMotionPresetTable } from './load-vrm-motion-preset-table.js';
import { createVrmLipsyncDriver } from './vrm-lipsync-driver.js';
import type { ActivityMapping } from './vrm-projection-adapter.js';

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

/** Method-record form used by the deferred projection shim so we can
 *  replay queued calls without per-method casts. */
type QueuedProjectionCall = (p: BackendProjection) => void;

export type DeferredProjectionHandle = {
  projection: BackendProjection;
  setAdapter(adapter: BackendProjection): void;
  reset(): void;
};

/**
 * Build a thin projection shim that buffers calls until the surface
 * (post-runtime-ready) registers the real adapter. Once registered,
 * queued calls are replayed in arrival order, then subsequent calls
 * dispatch directly. After `reset()` the shim is detached again
 * (used at branch.shutdown so a second start-up rebuilds cleanly).
 */
export function createDeferredProjection(): DeferredProjectionHandle {
  let adapter: BackendProjection | null = null;
  const queue: QueuedProjectionCall[] = [];

  const enqueueOrApply = (call: QueuedProjectionCall): void => {
    if (adapter) {
      call(adapter);
    } else {
      queue.push(call);
    }
  };

  const projection: BackendProjection = {
    applyActivity(input) {
      enqueueOrApply((p) => p.applyActivity(input));
    },
    applyEmotion(input) {
      enqueueOrApply((p) => p.applyEmotion(input));
    },
    applyMotion(input) {
      enqueueOrApply((p) => p.applyMotion(input));
    },
    applyExpression(input) {
      enqueueOrApply((p) => p.applyExpression(input));
    },
    reset() {
      enqueueOrApply((p) => p.reset());
    },
  };

  return {
    projection,
    setAdapter(a) {
      adapter = a;
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) next(a);
      }
    },
    reset() {
      adapter = null;
      queue.length = 0;
    },
  };
}

/**
 * Synchronously load the wlipsync profile JSON shipped under
 * `apps/avatar/assets/lip-sync/`. Mirrors the live2d branch loader
 * (live2d-backend-branch.ts) — async dynamic import + `with: { type:
 * 'json' }` ensures Vite emits a JSON module rather than re-parsing
 * text at runtime.
 */
async function loadLipsyncProfile(): Promise<Profile | null> {
  try {
    const mod = await import('../../../../assets/lip-sync/lip-sync-profile.json', {
      with: { type: 'json' },
    });
    return (mod as { default?: Profile }).default ?? (mod as unknown as Profile);
  } catch (err) {
    console.warn(
      '[avatar:vrm:lipsync] failed to load wlipsync profile JSON; lipsync silent',
      err,
    );
    return null;
  }
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
  /** Test seam: override the wlipsync profile loader (default: real
   *  JSON dynamic import). Returning null keeps the audio consumer in
   *  the silent path (matches the live2d profile-missing fallback). */
  loadProfileOverride?: () => Promise<Profile | null>;
};

export async function createVrmBackendBranch(
  manifest: VrmAvatarModelManifest,
  options: CreateVrmBackendBranchOptions = {},
): Promise<VrmBackendBranchHandle> {
  const mode = resolveRuntimeMode();

  // Synchronous table loads (chunks 3-A / 3-B); both throw if the YAML
  // drifts from the spec invariants — fail-close at construction.
  const emoteTable = loadVrmEmoteTable();
  const motionTable = loadVrmMotionPresetTable();

  // wlipsync profile is async (dynamic JSON import); profile === null
  // is an admitted degraded path (consumer warns once + silents on
  // attach).
  const profileLoader = options.loadProfileOverride ?? loadLipsyncProfile;
  const profile = await profileLoader();

  const audioConsumer = createVrmAudioConsumer({ profile });
  const emoteState = createVrmEmoteState({ emoteTable });
  const motionRegistry = createVrmMotionPresetRegistry({ table: motionTable });
  const lipsyncDriver = createVrmLipsyncDriver();

  // NAS resolver wraps the wave_1 activity-mapping table; chunk 3-C
  // adapter consumes the `resolveVrmRoute` shape only.
  const resolver = createActivityMappingResolver();
  const activityMapping: ActivityMapping = {
    resolveVrmRoute: (name) => resolver.resolveVrmRoute(name),
  };

  const deferredProjection = createDeferredProjection();

  let surface: BackendSurface;
  let surfaceShutdown: () => void = () => {};
  if (mode === 'dev_preview') {
    surface = createVrmDevPreviewBackendSurface(manifest);
  } else {
    const handle = createVrmCarrierSurface({
      manifest,
      audioConsumer,
      emoteState,
      motionRegistry,
      lipsyncDriver,
      activityMapping,
      setProjectionAdapter: deferredProjection.setAdapter,
      runtimeOptions: options.runtimeOptions,
    });
    surface = { Component: handle.Component };
    surfaceShutdown = handle.shutdown;
  }

  const branch: BackendBranch & { kind: 'vrm' } = {
    kind: 'vrm',
    nominalBounds: VRM_DEFAULT_NOMINAL_BOUNDS,
    projection: deferredProjection.projection,
    surface,
    metadata: () => ({
      model_kind: 'vrm',
      mode,
      vrm_file: manifest.vrm.vrmFile,
      motion_presets_dir: manifest.vrm.motionPresetsDir,
      lipsync_profile_present: profile !== null,
    }),
    shutdown() {
      // Order: stop frame-driven sources first, then drain projection,
      // then tear down surface (which disposes runtime + R3F canvas).
      try {
        motionRegistry.dispose();
      } catch {
        // dispose is defensive; never let it block surface shutdown.
      }
      audioConsumer.silent();
      deferredProjection.reset();
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
