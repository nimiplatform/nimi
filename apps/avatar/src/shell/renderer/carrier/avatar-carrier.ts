import type { AgentDataDriver } from '../driver/types.js';
import type { Live2DBackendSession } from '../live2d/backend-session.js';
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
import { recordAvatarEvidenceEventually } from '../app-shell/avatar-evidence.js';
import { createInteractionPhysicsController } from '../live2d/interaction-physics.js';
import {
  createLive2DCarrierVisualHost,
  Live2DCarrierVisualFrameError,
  type Live2DCarrierVisualFrameStats,
  type Live2DCarrierVisualHost,
} from '../live2d/carrier-visual-host.js';
import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';
import { createSmoothedProjection, type ProjectionSmoothingHandle } from '../nas/projection-smoothing.js';
import {
  resolveAvatarModelManifest,
  type AvatarModelManifest,
} from './model-resolver.js';
import { createBackendBranch, type BackendBranchHandle } from './create-backend-branch.js';
import type { BackendBranch } from './backend-branch.js';
import {
  createAvatarDebugSession,
  recordAvatarDebugSessionEvidence,
  type AvatarDebugResolverEvidence,
  type AvatarDebugSession,
  type RuntimeAvatarDebugProbeEnvelope,
} from '../avatar-debug/avatar-debug-session.js';

export type AvatarRuntimeCarrier = {
  model: AvatarModelManifest;
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
    recordEvidence?: boolean;
  }): AvatarDebugSession;
  attachRuntimeDriver(driver: AgentDataDriver): Promise<void>;
  detachRuntimeDriver(): void;
  shutdown(): void;
};

function countHandlers(registry: HandlerRegistry): number {
  return registry.activity.size + registry.event.size + registry.continuous.size;
}

function timeoutAfter<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}

function waitForNextCarrierVisualFrame(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, Math.min(120, 16 + attempt * 8));
  });
}

async function renderCarrierVisualFrameWithRetry(
  visualHost: Live2DCarrierVisualHost,
): Promise<{ attempts: number; stats: Live2DCarrierVisualFrameStats }> {
  const maxAttempts = 12;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {
        attempts: attempt,
        stats: visualHost.renderFrame({
          deltaTimeSeconds: attempt / 60,
          seconds: performance.now() / 1000,
        }),
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
      await waitForNextCarrierVisualFrame(attempt);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'Live2D bootstrap carrier visual proof failed'));
}

function toCarrierVisualFailureDetail(error: unknown, attempts: number | null): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    status: 'error',
    source: 'avatar-visual-carrier-bootstrap',
    error: error instanceof Error ? error.message : String(error || 'Live2D bootstrap carrier visual proof failed'),
  };
  if (typeof attempts === 'number') {
    detail.attempts = attempts;
  }
  if (error instanceof Live2DCarrierVisualFrameError) {
    detail.frame_stats = error.stats;
  }
  return detail;
}

async function recordBootstrapCarrierVisualProof(
  session: Live2DBackendSession,
  source = 'avatar-visual-carrier-bootstrap',
): Promise<void> {
  if (typeof document === 'undefined' || !session.execution?.loaded) {
    return;
  }
  let visualHost: Live2DCarrierVisualHost | null = null;
  let attempts: number | null = null;
  try {
    recordAvatarEvidenceEventually({
      kind: 'avatar.carrier.visual',
      detail: {
        status: 'loading',
        source,
      },
    });
    const canvas = document.createElement('canvas');
    visualHost = await Promise.race([
      createLive2DCarrierVisualHost({
        canvas,
        session,
        width: 360,
        height: 480,
      }),
        timeoutAfter<Live2DCarrierVisualHost>(8_000, 'Live2D bootstrap carrier visual proof timed out'),
      ]);
    attempts = 12;
    const result = await renderCarrierVisualFrameWithRetry(visualHost);
    attempts = result.attempts;
    const stats = result.stats;
    recordAvatarEvidenceEventually({
      kind: 'avatar.carrier.visual',
      detail: {
        status: 'ready',
        source,
        visible_pixels: stats.visiblePixels,
        visible_drawable_count: stats.visibleDrawableCount,
        canvas_width: stats.width,
        canvas_height: stats.height,
        sampled_pixels: stats.sampledPixels,
        sampled_pixel_checksum: stats.sampledPixelChecksum,
        texture_binding_count: stats.textureBindingCount,
        attempts,
      },
    });
  } catch (error) {
    recordAvatarEvidenceEventually({
      kind: 'avatar.carrier.visual',
      detail: toCarrierVisualFailureDetail(error, attempts),
    });
  } finally {
    visualHost?.unload();
  }
}

export async function startAvatarRuntimeCarrier(input: {
  driver: AgentDataDriver;
  modelPath?: string;
  modelManifest?: AvatarModelManifest;
}): Promise<AvatarRuntimeCarrier> {
  const carrier = await startAvatarVisualCarrier({
    modelPath: input.modelPath,
    modelManifest: input.modelManifest,
  });
  await carrier.attachRuntimeDriver(input.driver);
  return carrier;
}

export async function startAvatarVisualCarrier(input: {
  modelPath?: string;
  modelManifest?: AvatarModelManifest;
}): Promise<AvatarRuntimeCarrier> {
  const modelPath = input.modelPath?.trim() || input.modelManifest?.runtimeDir.trim() || '';
  if (!modelPath) {
    throw new Error('avatar visual carrier requires configured model_path');
  }
  const store = useAvatarStore.getState();
  store.setModelPath(modelPath);
  store.setModelLoading();

  let model: AvatarModelManifest;
  try {
    model = input.modelManifest ?? await resolveAvatarModelManifest(modelPath);
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

  const commandBus = backendHandle.commandBus;
  const backendSession = backendHandle.backendSession;
  const cueProjection = backendHandle.cueProjection;
  const executor = new HandlerExecutor();

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
    model_path: modelPath,
    runtime_dir: model.runtimeDir,
    nas_handler_count: countHandlers(registry),
    backend_kind: backendHandle.branch.kind,
    backend_metadata: backendHandle.branch.metadata(),
    // Branch metadata remains the canonical backend evidence surface; these
    // fields keep model-load evidence easy to query.
    compatibility_tier:
      backendSession?.compatibility.tier ?? null,
    adapter_id: backendSession?.compatibility.adapter?.adapter_id ?? null,
  };
  recordAvatarEvidenceEventually({
    kind: 'avatar.visual.model-loaded',
    detail: modelLoadDetail,
  });
  recordAvatarEvidenceEventually({
    kind: 'avatar.model.load',
    detail: modelLoadDetail,
  });
  const modelLoadEvent = {
    name: 'avatar.model.load',
    detail: modelLoadDetail,
  };
  if (backendSession) {
    void recordBootstrapCarrierVisualProof(backendSession);
  }

  return {
    model,
    registry,
    backend: backendHandle.branch,
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
      if (input.recordEvidence !== false) {
        recordAvatarDebugSessionEvidence(session);
      }
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
      projectionSmoothing = cueProjection
        ? createSmoothedProjection({ projection: cueProjection })
        : null;
      const runtimeCueProjection = projectionSmoothing?.projection ?? null;
      interactionPhysics = runtimeCueProjection
        ? createInteractionPhysicsController({ projection: runtimeCueProjection })
        : null;
      if (runtimeCueProjection && interactionPhysics) {
        unwireDispatch = wireEventDispatch({
          driver,
          registry,
          executor,
          projection: runtimeCueProjection,
          backendProjection: backendHandle.branch.projection,
          live2dExtension:
            backendHandle.branch.kind === 'live2d'
              ? backendHandle.branch.live2dExtension
              : undefined,
          interactionPhysics,
        });
      }
      // Wave 0 of topic 2026-04-30-avatar-vrm-backend-branch: voice-lipsync
      // wiring no longer takes `projection`, `mouthSignalId`, or a caller-
      // injected byte fetcher. Audio bytes are read via
      // `runtime.artifacts.readBytes` (S-RUNTIME-111) inside
      // AudioPipelineController; per-frame mouth movement comes from
      // BackendAudioConsumer.snapshot() once the BackendBranch carrier
      // wiring (this wave_1) lands the per-backend audio consumer.
      unwireVoiceLipsync = wireAvatarVoiceLipsync({
        driver,
      });
      if (runtimeCueProjection) {
        continuous = new ContinuousScheduler(
          registry,
          () => driver.getBundle(),
          runtimeCueProjection,
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
