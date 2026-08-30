// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// VRM BackendBranch factory. It composes emote state, generated motion
// runtime, the lipsync driver, projection adapter, and VRM audio consumer.
// The generated motion runtime is the
// product path; physical `.vrma` assets are interchange-only and missing
// deterministic generation fails closed rather than falling back.
//
// Product mode always mounts the real BackendBranch surface: VrmRuntime
// render recovery, <Canvas> + <VrmScene>, and the useFrame tick chain
// (lipsync driver → emote state → motion mixer → vrm.update). Environment
// selected placeholder branches are not admitted VRM success evidence.
//
// Queued projection adapter:
//   At factory time the VRM instance does not exist yet — the projection
//   adapter requires a loaded VRM. We expose a thin adapter implementing
//   BackendProjection that retains only the latest call in each bounded
//   semantic lane until the surface registers the real adapter. Recovery,
//   terminal failure, replacement, and shutdown detach the adapter and clear
//   pending cues so a failed scene never replays stale state.

import type { Profile } from 'wlipsync';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import type { BackendAudioConsumer } from '@nimiplatform/kit/features/avatar/headless';
import type {
  BackendActivityProjectionResult,
  BackendActivityProjectionSettlement,
  BackendBranch,
  BackendProjection,
  BackendSurface,
} from '../carrier/backend-branch.js';
import { createVrmActivityMappingResolver } from './vrm-activity-mapping.js';
import { createVrmCarrierSurface } from './vrm-carrier-surface.js';
import { VRM_DEFAULT_NOMINAL_BOUNDS } from './vrm-nominal-bounds.js';
import type { VrmRuntimeOptions } from './vrm-runtime.js';
import { createVrmAudioConsumer } from './vrm-audio-consumer.js';
import { createVrmEmoteState } from './vrm-emote-state.js';
import { loadVrmEmoteTable } from './load-vrm-emote-table.js';
import { createVrmGeneratedMotionRuntime } from './vrm-generated-motion-runtime.js';
import { createDeterministicVrmGeneratedMotionProvider } from './vrm-deterministic-motion-provider.js';
import { createVrmLipsyncDriver } from './vrm-lipsync-driver.js';
import type { ActivityMapping } from './vrm-projection-adapter.js';
import {
  createVrmRenderTarget,
  type VrmRenderTarget,
} from './vrm-render-target.js';
import type { VrmCapabilityProfile } from './vrm-capability-profile.js';
import { loadEmbeddedWLipSyncProfile } from '../lip-sync-profile.js';

// Wave 2 chunk 2-E: nominalBounds is the BOOT placeholder used by
// embodiment-stage for the very first window-resize tick (before VRM
// scene bbox is known). Per rule.nimi.avatar.embodiment.r003 this is a
// static field; post-load bounds flow through
// onSurfaceBoundsChange (carrier surface). VRM_DEFAULT_NOMINAL_BOUNDS is
// sourced from window-bounds-policy.yaml backends.vrm (360x720 +
// bottom-companion default bodyCenterY=0.55).

type VrmRuntimeMode = 'real_render';

/** Method-record form used by the queued projection adapter so we can
 *  replay the latest pending call in each semantic lane without per-method casts. */
type QueuedProjectionCall = Readonly<{
  apply(p: BackendProjection): void;
  cancel?(): void;
}>;
type QueuedProjectionLane = 'reset' | 'activity' | 'emotion' | 'motion' | 'expression';

export type QueuedProjectionHandle = {
  projection: BackendProjection;
  setAdapter(adapter: BackendProjection): void;
  reset(): void;
};

/**
 * Build a thin projection adapter that keeps at most one latest call per
 * semantic lane until the surface registers the real adapter. Replacing one
 * lane moves it to the newest replay position. A semantic reset clears every
 * older pending cue; the handle reset detaches and clears all cues during
 * recovery, terminal failure, replacement, and shutdown.
 */
// @nimi-authority: rule.nimi.avatar.embodiment.r057
export function createQueuedProjection(): QueuedProjectionHandle {
  let adapter: BackendProjection | null = null;
  const pending = new Map<QueuedProjectionLane, QueuedProjectionCall>();
  const unsettledActivities = new Set<{
    settle(value: BackendActivityProjectionSettlement): void;
  }>();

  const createPendingActivity = (): Readonly<{
    result: Extract<BackendActivityProjectionResult, { status: 'pending' }>;
    settle(value: BackendActivityProjectionSettlement): void;
  }> => {
    let settled = false;
    let resolveCompletion: (value: BackendActivityProjectionSettlement) => void = () => {};
    const completion = new Promise<BackendActivityProjectionSettlement>((resolve) => {
      resolveCompletion = resolve;
    });
    const control = {
      settle(value: BackendActivityProjectionSettlement) {
        if (settled) return;
        settled = true;
        unsettledActivities.delete(control);
        resolveCompletion(value);
      },
    };
    unsettledActivities.add(control);
    return {
      result: Object.freeze({ status: 'pending', completion }),
      settle: control.settle,
    };
  };

  const settleFromProjectionResult = (
    result: BackendActivityProjectionResult,
    settle: (value: BackendActivityProjectionSettlement) => void,
  ): void => {
    if (typeof result === 'string') {
      settle(result);
      return;
    }
    void result.completion.then(settle, () => settle('unsupported'));
  };

  const cancelEntry = (entry: QueuedProjectionCall | undefined): void => {
    entry?.cancel?.();
  };

  const cancelUnsettledActivities = (): void => {
    for (const activity of [...unsettledActivities]) activity.settle('canceled');
  };

  const cancelAllPending = (): void => {
    for (const entry of pending.values()) cancelEntry(entry);
    pending.clear();
    cancelUnsettledActivities();
  };

  const enqueueOrApply = (lane: Exclude<QueuedProjectionLane, 'reset'>, call: QueuedProjectionCall): void => {
    if (adapter) {
      call.apply(adapter);
    } else {
      cancelEntry(pending.get(lane));
      pending.delete(lane);
      pending.set(lane, call);
    }
  };

  const projection: BackendProjection = {
    applyActivity(input) {
      if (adapter) {
        cancelUnsettledActivities();
        const result = adapter.applyActivity(input);
        if (typeof result === 'string') return result;
        const pendingActivity = createPendingActivity();
        settleFromProjectionResult(result, pendingActivity.settle);
        return pendingActivity.result;
      }
      const pendingActivity = createPendingActivity();
      enqueueOrApply('activity', {
        apply(p) {
          try {
            settleFromProjectionResult(p.applyActivity(input), pendingActivity.settle);
          } catch (error) {
            pendingActivity.settle('unsupported');
            throw error;
          }
        },
        cancel: () => pendingActivity.settle('canceled'),
      });
      return pendingActivity.result;
    },
    applyEmotion(input) {
      enqueueOrApply('emotion', { apply: (p) => p.applyEmotion(input) });
    },
    applyMotion(input) {
      enqueueOrApply('motion', { apply: (p) => p.applyMotion(input) });
    },
    applyExpression(input) {
      enqueueOrApply('expression', { apply: (p) => p.applyExpression(input) });
    },
    reset() {
      if (adapter) {
        cancelAllPending();
        adapter.reset();
        return;
      }
      cancelAllPending();
      pending.set('reset', { apply: (p) => p.reset() });
    },
  };

  return {
    projection,
    setAdapter(a) {
      adapter = a;
      const replay = [...pending.values()];
      pending.clear();
      try {
        for (const next of replay) {
          next.apply(a);
        }
      } catch (error) {
        cancelAllPending();
        throw error;
      }
    },
    reset() {
      adapter = null;
      cancelAllPending();
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
  /** Test seam: override the wlipsync profile loader (default: embedded
   *  renderer module). Returning null keeps the audio consumer in
   *  the silent path (matches the live2d profile-missing fallback). */
  loadProfileOverride?: () => Promise<Profile | null>;
  /** Test seam: provide a pre-built render target (e.g. stub mode for
   *  jsdom). Default: real WebGL-backed `VrmRenderTarget`. The carrier
   *  surface drives `capture()` at ~10Hz throttle inside useFrame. */
  renderTargetOverride?: VrmRenderTarget;
};

// @nimi-authority: rule.nimi.avatar.embodiment.r056
export async function createVrmBackendBranch(
  manifest: VrmAvatarModelManifest,
  options: CreateVrmBackendBranchOptions = {},
): Promise<VrmBackendBranchHandle> {
  const mode: VrmRuntimeMode = 'real_render';

  // Synchronous emote table load throws if the YAML drifts from spec
  // invariants. Motion generation no longer loads vrm-motion-presets.yaml on
  // the runtime product path.
  const emoteTable = loadVrmEmoteTable();

  // The product path is a build-time renderer module. profile === null is
  // retained only for the explicit failure test seam below.
  const profile = options.loadProfileOverride
    ? await options.loadProfileOverride()
    : loadEmbeddedWLipSyncProfile();
  if (profile === null) {
    console.warn('[avatar:vrm] wLipSync profile is unavailable; lipsync will remain silent');
  }

  const audioConsumer = createVrmAudioConsumer({ profile });
  const emoteState = createVrmEmoteState({ emoteTable });
  const generatedMotionRuntime = createVrmGeneratedMotionRuntime(
    createDeterministicVrmGeneratedMotionProvider(),
  );
  const lipsyncDriver = createVrmLipsyncDriver();

  const resolver = createVrmActivityMappingResolver();
  const activityMapping: ActivityMapping = {
    resolveVrmRoute: (name) => resolver.resolveVrmRoute(name),
  };

  const queuedProjection = createQueuedProjection();

  // Wave 4 chunk 4-C: per-backend render target for alpha-mask hit-test
  // probing. The surface drives `capture()` from useFrame (throttled to
  // ~10Hz so the synchronous readPixels stall stays under the per-frame
  // budget). Tests pass a stub render target via `renderTargetOverride`.
  const renderTarget: VrmRenderTarget =
    options.renderTargetOverride ?? createVrmRenderTarget();
  let latestCapabilityProfile: VrmCapabilityProfile | null = null;
  let hitRegionPublished = false;

  let surfaceShutdown: () => void = () => {};
  const handle = createVrmCarrierSurface({
    manifest,
    audioConsumer,
    emoteState,
    generatedMotionRuntime,
    lipsyncDriver,
    activityMapping,
    setProjectionAdapter: queuedProjection.setAdapter,
    resetProjectionAdapter: queuedProjection.reset,
    runtimeOptions: options.runtimeOptions,
    renderTarget,
    onCapabilityProfile: (nextProfile) => {
      latestCapabilityProfile = nextProfile;
    },
    onHitRegionPublished: () => {
      hitRegionPublished = true;
    },
  });
  const surface: BackendSurface = { Component: handle.Component };
  surfaceShutdown = handle.shutdown;

  const branch: BackendBranch & { kind: 'vrm' } = {
    kind: 'vrm',
    nominalBounds: VRM_DEFAULT_NOMINAL_BOUNDS,
    projection: queuedProjection.projection,
    surface,
    metadata: () => ({
      model_kind: 'vrm',
      mode,
      vrm_file: manifest.vrm.vrmFile,
      generated_motion_provider: 'deterministic_vrm',
      vrma_position: 'interchange_only',
      lipsync_profile_present: profile !== null,
      hit_region_strategy: 'alpha_mask_plus_bbox',
      capability_profile_id: latestCapabilityProfile?.profileId ?? null,
      generated_motion_routes: latestCapabilityProfile?.generatedMotion.supportedRoutes ?? [],
      unsupported_generated_motion_routes:
        latestCapabilityProfile?.generatedMotion.unsupportedRoutes.map((route) => route.routeId) ?? [],
      expression_manager_present: latestCapabilityProfile?.expressionManagerPresent ?? false,
    }),
    debugFacts: () => ({
      kind: 'vrm',
      capabilityProfile: latestCapabilityProfile,
      lipsyncProfilePresent: profile !== null,
      hitRegionPublished,
    }),
    shutdown() {
      // Order: stop frame-driven sources first, then drain projection,
      // then tear down surface (which disposes runtime + R3F canvas).
      try {
        generatedMotionRuntime.dispose();
      } catch {
        // dispose is defensive; never let it block surface shutdown.
      }
      audioConsumer.silent();
      queuedProjection.reset();
      surfaceShutdown();
      try {
        renderTarget.dispose();
      } catch {
        // Defensive: render-target disposal is idempotent in real impl,
        // but stubs may have already been disposed by tests.
      }
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
