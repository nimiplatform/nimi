import type { AgentDataDriver } from '../driver/types.js';
import { wireEventDispatch } from '../semantic-projection/event-dispatch.js';
import { useAvatarStore } from '../app-shell/app-store.js';
import { wireAvatarVoiceLipsync } from '../voice-lipsync/avatar-voice-lipsync.js';
import { createInteractionPhysicsController } from '../live2d/interaction-physics.js';
import {
  createSmoothedSignalProjection,
  type AvatarSignalProjection,
  type SignalProjectionSmoothingHandle,
} from '../semantic-projection/signal-projection.js';
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

// @nimi-authority: definition.nimi.avatar.embodiment.projection-output
// @nimi-authority: rule.nimi.avatar.embodiment.r010
function createBackendSignalProjection(branch: BackendBranch): AvatarSignalProjection {
  const signalState = new Map<string, number>();
  const setSignalValue = (signalId: string, value: number): void => {
    if (branch.kind !== 'live2d') {
      throw new Error(`backend signal surface is not available for ${branch.kind}`);
    }
    signalState.set(signalId, value);
    branch.live2dExtension.setParameter(signalId, value);
  };
  return {
    setSignal(signalId, value) {
      setSignalValue(signalId, value);
    },
    getSignal(signalId) {
      return signalState.get(signalId) ?? 0;
    },
    addSignal(signalId, delta) {
      setSignalValue(signalId, (signalState.get(signalId) ?? 0) + delta);
    },
  };
}

export async function startAvatarRuntimeCarrier(input: {
  driver: AgentDataDriver;
  modelManifest: AvatarModelManifest;
  committedPresentationSelection?: AvatarCommittedPresentationSelection | null;
  publishModelState?: boolean;
}): Promise<AvatarRuntimeCarrier> {
  const carrier = await startAvatarVisualCarrier({
    modelManifest: input.modelManifest,
    committedPresentationSelection: input.committedPresentationSelection,
    publishModelState: input.publishModelState,
  });
  await carrier.attachRuntimeDriver(input.driver);
  return carrier;
}

// @nimi-authority: definition.nimi.avatar.embodiment.product-boundary
export async function startAvatarVisualCarrier(input: {
  modelManifest: AvatarModelManifest;
  committedPresentationSelection?: AvatarCommittedPresentationSelection | null;
  publishModelState?: boolean;
}): Promise<AvatarRuntimeCarrier> {
  const modelPath = input.modelManifest.runtimeDir.trim();
  if (!modelPath) {
    throw new Error('avatar visual carrier requires a typed model manifest with runtimeDir');
  }
  const store = useAvatarStore.getState();
  const publishModelState = input.publishModelState !== false;
  if (publishModelState) {
    store.setModelPath(modelPath);
    store.setModelLoading();
  }

  let model: AvatarModelManifest;
  try {
    model = input.modelManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (publishModelState) store.setModelError(message);
    throw error;
  }

  let backendHandle: BackendBranchHandle;
  try {
    backendHandle = await createBackendBranch(model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (publishModelState) store.setModelError(message);
    throw error;
  }

  const backendSignalProjection = createBackendSignalProjection(backendHandle.branch);

  let unwireDispatch: (() => void) | null = null;
  let unwireVoiceLipsync: (() => void) | null = null;
  let projectionSmoothing: SignalProjectionSmoothingHandle | null = null;
  let interactionPhysics: ReturnType<typeof createInteractionPhysicsController> | null = null;
  let attachedDriver: AgentDataDriver | null = null;
  const detachRuntimeDriver = () => {
    unwireVoiceLipsync?.();
    unwireVoiceLipsync = null;
    unwireDispatch?.();
    unwireDispatch = null;
    interactionPhysics?.reset();
    interactionPhysics = null;
    projectionSmoothing?.dispose();
    projectionSmoothing = null;
    attachedDriver = null;
  };
  if (publishModelState) store.setModelLoaded(model.modelId);
  const modelLoadDetail = {
    model_id: model.modelId,
    model_kind: backendHandle.branch.kind,
    backend_meta: backendHandle.branch.metadata(),
    loaded_at: new Date().toISOString(),
  };
  const modelLoadEvent = {
    name: 'avatar.model.load',
    detail: modelLoadDetail,
  };
  return {
    model,
    committedPresentationSelection: input.committedPresentationSelection ?? null,
    backend: backendHandle.branch,
    createDebugSession(input) {
      const backendFacts = backendHandle.branch.debugFacts?.() ?? null;
      const vrmCapabilityProfile = backendFacts?.kind === 'vrm'
        ? backendFacts.capabilityProfile
        : null;
      const profileRef = input.backendCapabilityProfileRef
        ?? vrmCapabilityProfile?.profileId
        ?? (backendFacts?.kind === 'live2d' ? backendFacts.capabilityProfile?.profileId : null)
        ?? backendCapabilityProfileRef(backendHandle.branch.metadata());
      const session = createAvatarDebugSession({
        debugSessionId: input.debugSessionId,
        probe: input.probe,
        avatarInstanceId: input.avatarInstanceId,
        avatarPackageRef: input.avatarPackageRef,
        backendCapabilityProfileRef: profileRef,
        backendKind: backendHandle.branch.kind,
        backend: backendHandle.branch,
        backendFacts,
        resolverEvidence: input.resolverEvidence ?? {
          packageResolved: Boolean(input.avatarPackageRef ?? model.modelId),
          capabilityProfileResolved: Boolean(profileRef),
        },
        vrmCapabilityProfile,
        observedAt: input.observedAt,
      });
      return session;
    },
    async attachRuntimeDriver(driver) {
      if (attachedDriver) {
        throw new Error('avatar visual carrier runtime driver is already attached');
      }
      attachedDriver = driver;
      projectionSmoothing = createSmoothedSignalProjection({ projection: backendSignalProjection });
      const runtimeCueProjection = projectionSmoothing?.projection ?? null;
      interactionPhysics = runtimeCueProjection && backendHandle.branch.kind === 'live2d'
        ? createInteractionPhysicsController({ projection: runtimeCueProjection })
        : null;
      if (runtimeCueProjection) {
        unwireDispatch = wireEventDispatch({
          driver,
          projection: backendHandle.branch.projection,
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
      driver.emit(modelLoadEvent);
    },
    detachRuntimeDriver,
    shutdown() {
      detachRuntimeDriver();
      backendHandle.shutdown();
    },
  };
}
