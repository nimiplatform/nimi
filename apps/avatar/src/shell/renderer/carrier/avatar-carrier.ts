import type { AgentDataDriver } from '../driver/types.js';
import { ContinuousScheduler, wireEventDispatch } from '../nas/event-dispatch.js';
import { HandlerExecutor } from '../nas/handler-executor.js';
import {
  createHandlerRegistry,
  disposeRegistry,
  populateRegistry,
  scanNasHandlers,
  startNasHandlerHotReload,
  type HandlerRegistry,
} from '../nas/handler-registry.js';
import { useAvatarStore } from '../app-shell/app-store.js';
import { wireAvatarVoiceLipsync } from '../voice-lipsync/avatar-voice-lipsync.js';
import { createInteractionPhysicsController } from '../live2d/interaction-physics.js';
import type { EmbodimentProjectionApi } from '@nimiplatform/kit/features/avatar/headless';
import { createSmoothedProjection, type ProjectionSmoothingHandle } from '@nimiplatform/kit/features/avatar/headless';
import { createBackendBranch, type BackendBranchHandle } from './create-backend-branch.js';
import type { AvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import type { BackendBranch } from './backend-branch.js';
import {
  createAvatarDebugSession,
  type AvatarDebugResolverEvidence,
  type AvatarDebugSession,
  type AvatarDebugProbeEnvelope,
} from '../avatar-debug/avatar-debug-session.js';

function backendCapabilityProfileRef(metadata: Record<string, unknown>): string | null {
  for (const key of [
    'backend_capability_profile_ref',
    'live2d_capability_profile_evidence_ref',
    'capability_profile_ref',
    'profile_id',
  ]) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export type AvatarCommittedPresentationSelection = {
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly previewMaterialRef: string;
  readonly presentationRevision: string;
};

export type AvatarRuntimeCarrier = {
  model: AvatarModelManifest;
  committedPresentationSelection: AvatarCommittedPresentationSelection | null;
  registry: HandlerRegistry;
  backend: BackendBranch;
  createDebugSession(input: {
    debugSessionId: string;
    probe: AvatarDebugProbeEnvelope;
    avatarInstanceId?: string | null;
    avatarPackageRef?: string | null;
    backendCapabilityProfileRef?: string | null;
    resolverEvidence?: AvatarDebugResolverEvidence | null;
    observedAt?: string | null;
  }): AvatarDebugSession;
  attachRuntimeDriver(driver: AgentDataDriver): Promise<void>;
  detachRuntimeDriver(): void;
  shutdown(): void;
};

function countHandlers(registry: HandlerRegistry): number {
  return registry.activity.size + registry.event.size + registry.continuous.size;
}

function activityIntensity(value: string | null | undefined): number | null {
  if (value === 'weak') return 0.25;
  if (value === 'moderate') return 0.5;
  if (value === 'strong') return 0.85;
  return null;
}

// @nimi-authority: definition.nimi.avatar.embodiment.nas-projection-api
// @nimi-authority: definition.nimi.avatar.embodiment.projection-output
// @nimi-authority: rule.nimi.avatar.embodiment.r010
function createBackendCueProjection(branch: BackendBranch): EmbodimentProjectionApi {
  const signalState = new Map<string, number>();
  const setSignalValue = (signalId: string, value: number): void => {
    if (branch.kind !== 'live2d') {
      throw new Error(`backend signal surface is not available for ${branch.kind}`);
    }
    signalState.set(signalId, value);
    branch.live2dExtension.setParameter(signalId, value);
  };
  return {
    async triggerMotion(motionId, opts) {
      branch.projection.applyMotion({
        routeId: motionId,
        loop: opts?.loop,
        fade: opts?.fadeIn,
      });
    },
    stopMotion() {
      branch.projection.reset();
    },
    setSignal(signalId, value) {
      setSignalValue(signalId, value);
    },
    getSignal(signalId) {
      return signalState.get(signalId) ?? 0;
    },
    addSignal(signalId, delta) {
      setSignalValue(signalId, (signalState.get(signalId) ?? 0) + delta);
    },
    async setExpression(expressionId) {
      branch.projection.applyExpression({ name: expressionId });
    },
    clearExpression() {
      branch.projection.reset();
    },
    setPose(poseId, loop) {
      branch.projection.applyMotion({ routeId: poseId, loop });
    },
    clearPose() {
      branch.projection.reset();
    },
    wait(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    },
    getSurfaceBounds() {
      return {
        x: 0,
        y: 0,
        width: branch.nominalBounds.width,
        height: branch.nominalBounds.height,
      };
    },
    async runDefaultActivity(activityId, options) {
      if (options.signal.aborted) return;
      branch.projection.applyActivity({
        name: activityId,
        intensity: activityIntensity(options.bundle.activity?.intensity),
      });
    },
  };
}

export async function startAvatarRuntimeCarrier(input: {
  driver: AgentDataDriver;
  modelManifest: AvatarModelManifest;
  committedPresentationSelection?: AvatarCommittedPresentationSelection | null;
}): Promise<AvatarRuntimeCarrier> {
  const carrier = await startAvatarVisualCarrier({
    modelManifest: input.modelManifest,
    committedPresentationSelection: input.committedPresentationSelection,
  });
  await carrier.attachRuntimeDriver(input.driver);
  return carrier;
}

// @nimi-authority: definition.nimi.avatar.embodiment.product-boundary
export async function startAvatarVisualCarrier(input: {
  modelManifest: AvatarModelManifest;
  committedPresentationSelection?: AvatarCommittedPresentationSelection | null;
}): Promise<AvatarRuntimeCarrier> {
  const modelPath = input.modelManifest.runtimeDir.trim();
  if (!modelPath) {
    throw new Error('avatar visual carrier requires a typed model manifest with runtimeDir');
  }
  const store = useAvatarStore.getState();
  store.setModelPath(modelPath);
  store.setModelLoading();

  let model: AvatarModelManifest;
  try {
    model = input.modelManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setModelError(message);
    throw error;
  }

  const registry = createHandlerRegistry();
  if (model.nimiDir) {
    const manifest = await scanNasHandlers(model.nimiDir);
    await populateRegistry(registry, manifest, { backendKind: model.kind });
  }

  let stopNasHotReload: (() => Promise<void>) | null = null;
  let backendHandle: BackendBranchHandle;
  try {
    backendHandle = await createBackendBranch(model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setModelError(message);
    disposeRegistry(registry);
    throw error;
  }

  const executor = new HandlerExecutor();
  const backendCueProjection = createBackendCueProjection(backendHandle.branch);

  let unwireDispatch: (() => void) | null = null;
  let unwireVoiceLipsync: (() => void) | null = null;
  let continuous: ContinuousScheduler | null = null;
  let projectionSmoothing: ProjectionSmoothingHandle | null = null;
  let interactionPhysics: ReturnType<typeof createInteractionPhysicsController> | null = null;
  let attachedDriver: AgentDataDriver | null = null;
  const detachRuntimeDriver = () => {
    continuous?.stop();
    continuous = null;
    unwireVoiceLipsync?.();
    unwireVoiceLipsync = null;
    unwireDispatch?.();
    unwireDispatch = null;
    void stopNasHotReload?.().catch((err: unknown) => {
      console.warn(`[avatar:nas] failed to stop hot reload watcher: ${err instanceof Error ? err.message : String(err)}`);
    });
    stopNasHotReload = null;
    interactionPhysics?.reset();
    interactionPhysics = null;
    projectionSmoothing?.dispose();
    projectionSmoothing = null;
    attachedDriver = null;
  };
  store.setModelLoaded(model.modelId);
  const modelLoadDetail = {
    model_id: model.modelId,
    model_kind: backendHandle.branch.kind,
    backend_meta: backendHandle.branch.metadata(),
    nas_handler_count: countHandlers(registry),
    loaded_at: new Date().toISOString(),
  };
  const modelLoadEvent = {
    name: 'avatar.model.load',
    detail: modelLoadDetail,
  };
  return {
    model,
    committedPresentationSelection: input.committedPresentationSelection ?? null,
    registry,
    backend: backendHandle.branch,
    createDebugSession(input) {
      const profileRef = input.backendCapabilityProfileRef
        ?? backendCapabilityProfileRef(backendHandle.branch.metadata());
      const session = createAvatarDebugSession({
        debugSessionId: input.debugSessionId,
        probe: input.probe,
        avatarInstanceId: input.avatarInstanceId,
        avatarPackageRef: input.avatarPackageRef,
        backendCapabilityProfileRef: profileRef,
        backendKind: backendHandle.branch.kind,
        backend: backendHandle.branch,
        resolverEvidence: input.resolverEvidence ?? {
          packageResolved: Boolean(input.avatarPackageRef ?? model.modelId),
          capabilityProfileResolved: Boolean(profileRef),
        },
        observedAt: input.observedAt,
      });
      return session;
    },
    async attachRuntimeDriver(driver) {
      if (attachedDriver) {
        throw new Error('avatar visual carrier runtime driver is already attached');
      }
      attachedDriver = driver;
      if (model.nimiDir) {
        stopNasHotReload = await startNasHandlerHotReload({
          modelId: model.modelId,
          nimiDir: model.nimiDir,
          registry,
          emit: (event) => driver.emit(event),
          backendKind: model.kind,
        });
      }
      projectionSmoothing = createSmoothedProjection({ projection: backendCueProjection });
      const runtimeCueProjection = projectionSmoothing?.projection ?? null;
      interactionPhysics = runtimeCueProjection && backendHandle.branch.kind === 'live2d'
        ? createInteractionPhysicsController({ projection: runtimeCueProjection })
        : null;
      if (runtimeCueProjection) {
        unwireDispatch = wireEventDispatch({
          driver,
          registry,
          executor,
          projection: backendHandle.branch.projection,
          live2dExtension:
            backendHandle.branch.kind === 'live2d'
              ? backendHandle.branch.live2dExtension
              : undefined,
          ...(interactionPhysics ? { interactionPhysics } : {}),
        });
      }
      // The backend-branch hard cut removes `projection`, `mouthSignalId`, and
      // the caller-
      // injected byte fetcher. Audio bytes are read via
      // `runtime.artifacts.readArtifactBytes` (S-RUNTIME-111) inside
      // AudioPipelineController; per-frame mouth movement comes from
      // BackendAudioConsumer.snapshot() through the mounted backend surface.
      unwireVoiceLipsync = wireAvatarVoiceLipsync({
        driver,
      });
      if (runtimeCueProjection) {
        continuous = new ContinuousScheduler(
          registry,
          () => driver.getBundle(),
          backendHandle.branch.projection,
        );
        continuous.start();
      }
      driver.emit(modelLoadEvent);
    },
    detachRuntimeDriver,
    shutdown() {
      detachRuntimeDriver();
      executor.cancelAll();
      disposeRegistry(registry);
      backendHandle.shutdown();
    },
  };
}
