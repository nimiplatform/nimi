import type { AgentDataDriver } from '../driver/types.js';
import { createCommandBus, createLive2DBackendApi, type Live2DCommandBus } from '../live2d/plugin-api.js';
import { waitForCubismCore } from '../live2d/cubism-bootstrap.js';
import { createLive2DBackendSession, type Live2DBackendSession } from '../live2d/backend-session.js';
import { loadOfficialCubismFrameworkRuntime } from '../live2d/cubism-framework-runtime.js';
import { ContinuousScheduler, wireEventDispatch } from '../nas/event-dispatch.js';
import { HandlerExecutor } from '../nas/handler-executor.js';
import { createHandlerRegistry, disposeRegistry, populateRegistry, scanNasHandlers, type HandlerRegistry } from '../nas/handler-registry.js';
import { resolveModelManifest, type ModelManifest } from '../live2d/model-loader.js';
import { useAvatarStore } from '../app-shell/app-store.js';

export type AvatarRuntimeCarrier = {
  model: ModelManifest;
  registry: HandlerRegistry;
  commandBus: Live2DCommandBus;
  backendSession: Live2DBackendSession;
  shutdown(): void;
};

function countHandlers(registry: HandlerRegistry): number {
  return registry.activity.size + registry.event.size + registry.continuous.size;
}

export async function startAvatarRuntimeCarrier(input: {
  driver: AgentDataDriver;
  modelPath: string;
}): Promise<AvatarRuntimeCarrier> {
  const modelPath = input.modelPath.trim();
  if (!modelPath) {
    throw new Error('avatar runtime carrier requires configured model_path');
  }
  const store = useAvatarStore.getState();
  store.setModelPath(modelPath);
  store.setModelLoading();

  let model: ModelManifest;
  try {
    model = await resolveModelManifest(modelPath);
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
  let backendSession: Live2DBackendSession;
  try {
    const core = await waitForCubismCore();
    const framework = await loadOfficialCubismFrameworkRuntime();
    backendSession = await createLive2DBackendSession(model, { core, framework });
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
  const unwireDispatch = wireEventDispatch({
    driver: input.driver,
    registry,
    executor,
    projection,
  });
  const continuous = new ContinuousScheduler(
    registry,
    () => input.driver.getBundle(),
    projection,
  );
  continuous.start();
  store.setModelLoaded(model.modelId);
  input.driver.emit({
    name: 'avatar.model.load',
    detail: {
      model_id: model.modelId,
      model_path: modelPath,
      runtime_dir: model.runtimeDir,
      nas_handler_count: countHandlers(registry),
    },
  });

  return {
    model,
    registry,
    commandBus,
    backendSession,
    shutdown() {
      continuous.stop();
      unwireDispatch();
      unwireBackend();
      executor.cancelAll();
      disposeRegistry(registry);
      backendSession.unload();
    },
  };
}
