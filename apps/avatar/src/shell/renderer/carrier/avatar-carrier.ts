import type { AgentDataDriver } from '../driver/types.js';
import { createCommandBus, createLive2DBackendApi, type Live2DCommandBus } from '../live2d/plugin-api.js';
import { waitForCubismCore } from '../live2d/cubism-bootstrap.js';
import { createLive2DBackendSession, type Live2DBackendSession } from '../live2d/backend-session.js';
import { loadOfficialCubismFrameworkRuntime } from '../live2d/cubism-framework-runtime.js';
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
import { resolveModelManifest, type ModelManifest } from '../live2d/model-loader.js';
import { useAvatarStore } from '../app-shell/app-store.js';
import { wireAvatarVoiceLipsync } from '../voice-lipsync/avatar-voice-lipsync.js';
import { recordAvatarEvidenceEventually } from '../app-shell/avatar-evidence.js';
import { createInteractionPhysicsController } from '../live2d/interaction-physics.js';
import { parseLive2DAdapterManifest, type Live2DAdapterManifestV1 } from '../live2d/compatibility.js';
import { readTextFile } from '../live2d/model-loader.js';
import {
  createLive2DCarrierVisualHost,
  Live2DCarrierVisualFrameError,
  type Live2DCarrierVisualFrameStats,
  type Live2DCarrierVisualHost,
} from '../live2d/carrier-visual-host.js';

export type AvatarRuntimeCarrier = {
  model: ModelManifest;
  registry: HandlerRegistry;
  commandBus: Live2DCommandBus;
  backendSession: Live2DBackendSession;
  attachRuntimeDriver(driver: AgentDataDriver): Promise<void>;
  detachRuntimeDriver(): void;
  shutdown(): void;
};

function countHandlers(registry: HandlerRegistry): number {
  return registry.activity.size + registry.event.size + registry.continuous.size;
}

async function loadEmbeddedAdapterManifest(model: ModelManifest): Promise<Live2DAdapterManifestV1 | null> {
  if (!model.adapterManifestPath) {
    return null;
  }
  const raw = await readTextFile(model.adapterManifestPath);
  return parseLive2DAdapterManifest(raw);
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
  modelManifest?: ModelManifest;
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
  modelManifest?: ModelManifest;
}): Promise<AvatarRuntimeCarrier> {
  const modelPath = input.modelPath?.trim() || input.modelManifest?.runtimeDir.trim() || '';
  if (!modelPath) {
    throw new Error('avatar visual carrier requires configured model_path');
  }
  const store = useAvatarStore.getState();
  store.setModelPath(modelPath);
  store.setModelLoading();

  let model: ModelManifest;
  try {
    model = input.modelManifest ?? await resolveModelManifest(modelPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setModelError(message);
    throw error;
  }

  const registry = createHandlerRegistry();
  if (model.nimiDir) {
    const manifest = await scanNasHandlers(model.nimiDir);
    await populateRegistry(registry, manifest);
  }

  const commandBus = createCommandBus();
  let stopNasHotReload: (() => Promise<void>) | null = null;
  let backendSession: Live2DBackendSession;
  try {
    const adapterManifest = await loadEmbeddedAdapterManifest(model);
    const core = await waitForCubismCore();
    const framework = await loadOfficialCubismFrameworkRuntime();
    backendSession = await createLive2DBackendSession(model, { core, framework, adapterManifest });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setModelError(message);
    disposeRegistry(registry);
    throw error;
  }
  const unwireBackend = commandBus.on('command', (command) => {
    backendSession.applyCommand(command);
  });
  const parameterState = new Map<string, number>();
  const projection = createLive2DBackendApi({
    commandBus,
    parameterState,
    compatibility: backendSession.compatibility,
    bounds: () => {
      const state = useAvatarStore.getState();
      return {
        x: 0,
        y: 0,
        width: state.shell.windowSize.width,
        height: state.shell.windowSize.height,
      };
    },
  });
  const executor = new HandlerExecutor();
  const interactionPhysics = createInteractionPhysicsController({ projection });
  let unwireDispatch: (() => void) | null = null;
  let unwireVoiceLipsync: (() => void) | null = null;
  let continuous: ContinuousScheduler | null = null;
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
    attachedDriver = null;
  };
  store.setModelLoaded(model.modelId);
  const modelLoadDetail = {
    model_id: model.modelId,
    model_path: modelPath,
    runtime_dir: model.runtimeDir,
    nas_handler_count: countHandlers(registry),
    compatibility_tier: backendSession.compatibility.tier,
    adapter_id: backendSession.compatibility.adapter?.adapter_id ?? null,
  };
  recordAvatarEvidenceEventually({
    kind: 'avatar.visual.model-loaded',
    detail: modelLoadDetail,
  });
  const modelLoadEvent = {
    name: 'avatar.model.load',
    detail: modelLoadDetail,
  };
  void recordBootstrapCarrierVisualProof(backendSession);

  return {
    model,
    registry,
    commandBus,
    backendSession,
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
        });
      }
      unwireDispatch = wireEventDispatch({
        driver,
        registry,
        executor,
        projection,
        interactionPhysics,
      });
      unwireVoiceLipsync = wireAvatarVoiceLipsync({
        driver,
        projection,
        mouthSignalId: backendSession.compatibility.mouthOpenParameterId,
      });
      continuous = new ContinuousScheduler(
        registry,
        () => driver.getBundle(),
        projection,
      );
      continuous.start();
      driver.emit(modelLoadEvent);
      recordAvatarEvidenceEventually({
        kind: 'avatar.model.load',
        detail: modelLoadEvent.detail,
      });
    },
    detachRuntimeDriver,
    shutdown() {
      detachRuntimeDriver();
      unwireBackend();
      interactionPhysics.reset();
      executor.cancelAll();
      disposeRegistry(registry);
      backendSession.unload();
    },
  };
}
