import type { AgentDataDriver } from '../driver/types.js';
import { AvatarDebugProbeKind, AvatarDebugProbeStatus, type AvatarDebugProbeResultEnvelope } from '@nimiplatform/sdk/runtime/wire-types';
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
  evidenceRefsForAvatarDebugSession,
  type AvatarDebugResolverEvidence,
  type AvatarDebugSession,
  type RuntimeAvatarDebugProbeEnvelope,
} from '../avatar-debug/avatar-debug-session.js';
import { ulid } from '../infra/ids.js';

type RuntimeAvatarDebugEvent = {
  name: string;
  timestamp: string;
  detail: Record<string, unknown>;
};

type RuntimeAvatarDebugTimestamp = NonNullable<AvatarDebugProbeResultEnvelope['observedAt']>;

function timestampFromIso(value: string): RuntimeAvatarDebugTimestamp {
  const millis = Date.parse(value);
  const safeMillis = Number.isFinite(millis) ? millis : Date.now();
  return {
    seconds: String(Math.floor(safeMillis / 1000)),
    nanos: (safeMillis % 1000) * 1_000_000,
  };
}

function detailText(detail: Record<string, unknown>, key: string): string {
  const value = detail[key];
  return typeof value === 'string' ? value.trim() : '';
}

function detailProbeKind(detail: Record<string, unknown>): AvatarDebugProbeKind {
  const value = detail.probeKind;
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value as AvatarDebugProbeKind;
  }
  throw new Error('avatar debug probe request missing probeKind');
}

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

function runtimeStatusForAvatarDebug(status: AvatarDebugSession['evidence']['status']): AvatarDebugProbeStatus {
  switch (status) {
    case 'passed':
      return AvatarDebugProbeStatus.PASSED;
    case 'failed':
      return AvatarDebugProbeStatus.FAILED;
    case 'unsupported':
      return AvatarDebugProbeStatus.UNSUPPORTED;
    case 'invalid':
      return AvatarDebugProbeStatus.INVALID;
  }
}

function isAvatarSubmittableDebugProbeKind(probeKind: AvatarDebugProbeKind): boolean {
  switch (probeKind) {
    case AvatarDebugProbeKind.BACKEND_LOAD:
    case AvatarDebugProbeKind.CAPABILITY_PROFILE:
    case AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX:
    case AvatarDebugProbeKind.GENERATED_MOTION:
    case AvatarDebugProbeKind.EMOTION_EXPRESSION:
    case AvatarDebugProbeKind.SPEECH_LIPSYNC:
    case AvatarDebugProbeKind.WINDOW_HIT_REGION:
      return true;
    default:
      return false;
  }
}

async function submitRuntimeAvatarDebugResult(input: {
  event: RuntimeAvatarDebugEvent;
  backendKind: AvatarDebugSession['backendKind'];
  backend: BackendBranch;
  avatarPackageRef: string | null;
  backendCapabilityProfileRef: string | null;
  submitDebugProbeResult?: (result: AvatarDebugProbeResultEnvelope) => Promise<void>;
}): Promise<void> {
  const { event, submitDebugProbeResult } = input;
  if (!submitDebugProbeResult) {
    return;
  }
  const detail = event.detail;
  const probeId = detailText(detail, 'probeId');
  const agentId = detailText(detail, 'agentId') || detailText(detail, 'agent_id');
  const conversationAnchorId = detailText(detail, 'conversationAnchorId') || detailText(detail, 'conversation_anchor_id');
  const observedAt = new Date().toISOString();
  let probeKind: AvatarDebugProbeKind;
  try {
    probeKind = detailProbeKind(detail);
  } catch (error) {
    console.warn('[avatar:debug] runtime probe request has an invalid probe kind', error);
    return;
  }
  if (!probeId || !agentId || !conversationAnchorId) {
    console.warn('[avatar:debug] runtime probe request is missing its probe, agent, or conversation identity');
    return;
  }
  if (!isAvatarSubmittableDebugProbeKind(probeKind)) {
    console.warn(`[avatar:debug] runtime probe ${probeId} uses unsupported kind ${probeKind}`);
    return;
  }
  try {
    const session = createAvatarDebugSession({
      debugSessionId: probeId,
      runtimeProbe: {
        probeId,
        agentId,
        probeKind,
      },
      avatarInstanceId: detailText(detail, 'avatarInstanceId') || detailText(detail, 'avatar_instance_id') || null,
      avatarPackageRef: input.avatarPackageRef,
      backendCapabilityProfileRef: input.backendCapabilityProfileRef,
      backendKind: input.backendKind,
      backend: input.backend,
      resolverEvidence: {
        packageResolved: Boolean(input.avatarPackageRef),
        capabilityProfileResolved: Boolean(input.backendCapabilityProfileRef),
      },
      observedAt,
    });
    await submitDebugProbeResult({
      probeId,
      agentId,
      conversationAnchorId,
      probeKind: session.probeKind,
      status: runtimeStatusForAvatarDebug(session.evidence.status),
      observedAt: timestampFromIso(session.observedAt),
      evidenceRefs: evidenceRefsForAvatarDebugSession(session),
      reasonCode: session.evidence.reasonCode || '',
      resultId: `avatar-debug-result-${ulid()}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown avatar debug session failure');
    console.warn(`[avatar:debug] probe ${probeId} evaluation failed: ${message}`);
    await submitDebugProbeResult({
      probeId,
      agentId,
      conversationAnchorId,
      probeKind,
      status: AvatarDebugProbeStatus.FAILED,
      observedAt: timestampFromIso(observedAt),
      evidenceRefs: [],
      reasonCode: 'avatar_debug_session_evaluation_failed',
      resultId: `avatar-debug-result-${ulid()}`,
    }).catch((submitError: unknown) => {
      console.warn(`[avatar:debug] failed to submit probe ${probeId} result`, submitError);
    });
  }
}

export type AvatarCommittedPresentationSelection = {
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly previewMaterialRef: string;
};

export type AvatarRuntimeCarrier = {
  model: AvatarModelManifest;
  committedPresentationSelection: AvatarCommittedPresentationSelection | null;
  registry: HandlerRegistry;
  backend: BackendBranch;
  createDebugSession(input: {
    debugSessionId: string;
    runtimeProbe: RuntimeAvatarDebugProbeEnvelope;
    avatarInstanceId?: string | null;
    avatarPackageRef?: string | null;
    backendCapabilityProfileRef?: string | null;
    resolverEvidence?: AvatarDebugResolverEvidence | null;
    observedAt?: string | null;
  }): AvatarDebugSession;
  submitDebugProbeResult?(result: AvatarDebugProbeResultEnvelope): Promise<void>;
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
  submitDebugProbeResult?: (result: AvatarDebugProbeResultEnvelope) => Promise<void>;
}): Promise<AvatarRuntimeCarrier> {
  const carrier = await startAvatarVisualCarrier({
    modelManifest: input.modelManifest,
    committedPresentationSelection: input.committedPresentationSelection,
    submitDebugProbeResult: input.submitDebugProbeResult,
  });
  await carrier.attachRuntimeDriver(input.driver);
  return carrier;
}

// @nimi-authority: definition.nimi.avatar.embodiment.product-boundary
export async function startAvatarVisualCarrier(input: {
  modelManifest: AvatarModelManifest;
  committedPresentationSelection?: AvatarCommittedPresentationSelection | null;
  submitDebugProbeResult?: (result: AvatarDebugProbeResultEnvelope) => Promise<void>;
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
  let unwireDebugProbe: (() => void) | null = null;
  let continuous: ContinuousScheduler | null = null;
  let projectionSmoothing: ProjectionSmoothingHandle | null = null;
  let interactionPhysics: ReturnType<typeof createInteractionPhysicsController> | null = null;
  let attachedDriver: AgentDataDriver | null = null;
  const detachRuntimeDriver = () => {
    continuous?.stop();
    continuous = null;
    unwireVoiceLipsync?.();
    unwireVoiceLipsync = null;
    unwireDebugProbe?.();
    unwireDebugProbe = null;
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
  void backendHandle.verifyBootstrapVisualOutput?.().catch((error: unknown) => {
    console.warn('[avatar:carrier] bootstrap visual output probe failed', error);
  });

  return {
    model,
    committedPresentationSelection: input.committedPresentationSelection ?? null,
    registry,
    backend: backendHandle.branch,
    submitDebugProbeResult: input.submitDebugProbeResult,
    createDebugSession(input) {
      const session = createAvatarDebugSession({
        debugSessionId: input.debugSessionId,
        runtimeProbe: input.runtimeProbe,
        avatarInstanceId: input.avatarInstanceId,
        avatarPackageRef: input.avatarPackageRef,
        backendCapabilityProfileRef: input.backendCapabilityProfileRef,
        backendKind: backendHandle.branch.kind,
        backend: backendHandle.branch,
        resolverEvidence: input.resolverEvidence,
        observedAt: input.observedAt,
      });
      return session;
    },
    async attachRuntimeDriver(driver) {
      if (attachedDriver) {
        throw new Error('avatar visual carrier runtime driver is already attached');
      }
      attachedDriver = driver;
      unwireDebugProbe = driver.onEvent((event) => {
        if (event.name !== 'runtime.agent.avatar_debug.probe_requested') {
          return;
        }
        void submitRuntimeAvatarDebugResult({
          event,
          backendKind: backendHandle.branch.kind,
          backend: backendHandle.branch,
          avatarPackageRef: model.modelId,
          backendCapabilityProfileRef: backendCapabilityProfileRef(backendHandle.branch.metadata()),
          submitDebugProbeResult: input.submitDebugProbeResult,
        });
      });
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
