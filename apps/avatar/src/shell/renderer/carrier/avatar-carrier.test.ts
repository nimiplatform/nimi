import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, DriverStatus } from '../driver/types.js';
import { useAvatarStore } from '../app-shell/app-store.js';

const resolveModelManifestMock = vi.fn();
const scanNasHandlersMock = vi.fn();
const populateRegistryMock = vi.fn();
const startNasHandlerHotReloadMock = vi.fn();
const stopNasHandlerHotReloadMock = vi.fn();
const waitForCubismCoreMock = vi.fn();
const loadOfficialCubismFrameworkRuntimeMock = vi.fn();
const createLive2DBackendSessionMock = vi.fn();
const backendApplyCommandMock = vi.fn();
const backendUnloadMock = vi.fn();

vi.mock('../live2d/model-loader.js', () => ({
  resolveModelManifest: (...args: unknown[]) => resolveModelManifestMock(...args),
}));

vi.mock('../live2d/cubism-bootstrap.js', () => ({
  waitForCubismCore: (...args: unknown[]) => waitForCubismCoreMock(...args),
}));

vi.mock('../live2d/cubism-framework-runtime.js', () => ({
  loadOfficialCubismFrameworkRuntime: (...args: unknown[]) => loadOfficialCubismFrameworkRuntimeMock(...args),
}));

vi.mock('../live2d/backend-session.js', () => ({
  createLive2DBackendSession: (...args: unknown[]) => createLive2DBackendSessionMock(...args),
}));

vi.mock('../nas/handler-registry.js', async () => {
  const actual = await vi.importActual<typeof import('../nas/handler-registry.js')>('../nas/handler-registry.js');
  return {
    ...actual,
    scanNasHandlers: (...args: unknown[]) => scanNasHandlersMock(...args),
    populateRegistry: (...args: unknown[]) => populateRegistryMock(...args),
    startNasHandlerHotReload: (...args: unknown[]) => startNasHandlerHotReloadMock(...args),
  };
});

function createBundle(): AgentDataBundle {
  return {
    activity: {
      name: 'happy',
      category: 'emotion',
      intensity: 'moderate',
      source: 'apml_output',
    },
    posture: {
      posture_class: 'baseline',
      action_family: 'observe',
      interrupt_mode: 'welcome',
      transition_reason: 'test',
      truth_basis_ids: [],
    },
    status_text: '',
    execution_state: 'IDLE',
    active_world_id: 'world-1',
    active_user_id: 'user-1',
    app: {
      namespace: 'avatar',
      surface_id: 'avatar-window',
      visible: true,
      focused: true,
      window: { x: 0, y: 0, width: 400, height: 600 },
      cursor_x: 0,
      cursor_y: 0,
    },
    runtime: {
      now: '2026-04-25T00:00:00.000Z',
      session_id: 'anchor-1',
      locale: 'en-US',
    },
  };
}

function createDriver() {
  let eventHandler: ((event: AgentEvent) => void) | null = null;
  const emitted: Array<{ name: string; detail: Record<string, unknown> }> = [];
  const driver: AgentDataDriver & { trigger(event: AgentEvent): void; emitted: typeof emitted } = {
    kind: 'sdk',
    status: 'running' as DriverStatus,
    async start() {},
    async stop() {},
    getBundle: () => createBundle(),
    onEvent(handler) {
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    },
    onBundleChange() {
      return () => {};
    },
    onStatusChange() {
      return () => {};
    },
    emit(event) {
      emitted.push(event);
    },
    trigger(event) {
      eventHandler?.(event);
    },
    emitted,
  };
  return driver;
}

describe('avatar runtime carrier', () => {
  beforeEach(() => {
    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    resolveModelManifestMock.mockReset();
    scanNasHandlersMock.mockReset();
    populateRegistryMock.mockReset();
    startNasHandlerHotReloadMock.mockReset();
    stopNasHandlerHotReloadMock.mockReset();
    waitForCubismCoreMock.mockReset();
    loadOfficialCubismFrameworkRuntimeMock.mockReset();
    createLive2DBackendSessionMock.mockReset();
    backendApplyCommandMock.mockReset();
    backendUnloadMock.mockReset();
    resolveModelManifestMock.mockResolvedValue({
      runtimeDir: '/models/ren/runtime',
      modelId: 'ren',
      model3JsonPath: '/models/ren/runtime/ren.model3.json',
      nimiDir: null,
    });
    scanNasHandlersMock.mockResolvedValue({
      activity: [],
      event: [],
      continuous: [],
      configJsonPath: null,
    });
    populateRegistryMock.mockResolvedValue(undefined);
    stopNasHandlerHotReloadMock.mockResolvedValue(undefined);
    startNasHandlerHotReloadMock.mockResolvedValue(stopNasHandlerHotReloadMock);
    waitForCubismCoreMock.mockResolvedValue({ Version: { csmGetVersion: () => 1, csmGetLatestMocVersion: () => 1 } });
    loadOfficialCubismFrameworkRuntimeMock.mockResolvedValue({ CubismFramework: {} });
    createLive2DBackendSessionMock.mockResolvedValue({
      applyCommand: (...args: unknown[]) => backendApplyCommandMock(...args),
      unload: (...args: unknown[]) => backendUnloadMock(...args),
    });
  });

  it('loads model manifest and uses Live2D default activity fallback when no NAS handler exists', async () => {
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelPath: '/models/ren',
    });
    const commands: string[] = [];
    const unsubscribeCommand = carrier.commandBus.on('command', (command) => {
      if (command.kind === 'motion') {
        commands.push(command.group);
      }
    });

    driver.trigger({
      event_id: 'event-1',
      name: 'apml.state.activity',
      timestamp: '2026-04-25T00:00:01.000Z',
      detail: {
        activity_name: 'happy',
      },
    });
    await Promise.resolve();

    expect(resolveModelManifestMock).toHaveBeenCalledWith('/models/ren');
    expect(scanNasHandlersMock).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().model).toEqual(expect.objectContaining({
      modelPath: '/models/ren',
      modelId: 'ren',
      loadState: 'loaded',
      error: null,
    }));
    expect(driver.emitted).toContainEqual({
      name: 'avatar.model.load',
      detail: expect.objectContaining({
        model_id: 'ren',
        nas_handler_count: 0,
      }),
    });
    expect(commands).toEqual(['Activity_Happy']);

    unsubscribeCommand();
    carrier.shutdown();
  });

  it('dispatches runtime passthrough events to matching NAS event handlers', async () => {
    const handler = {
      execute: vi.fn(async () => undefined),
    };
    populateRegistryMock.mockImplementation(async (registry: {
      event: Map<string, { kind: 'event'; eventName: string; handler: typeof handler; sourcePath: string }>;
    }) => {
      registry.event.set('runtime.agent.hook.running', {
        kind: 'event',
        eventName: 'runtime.agent.hook.running',
        handler,
        sourcePath: '/models/ren/runtime/nimi/event/runtime_agent_hook_running.js',
      });
    });
    resolveModelManifestMock.mockResolvedValue({
      runtimeDir: '/models/ren/runtime',
      modelId: 'ren',
      model3JsonPath: '/models/ren/runtime/ren.model3.json',
      nimiDir: '/models/ren/runtime/nimi',
    });
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelPath: '/models/ren',
    });

    driver.trigger({
      event_id: 'event-2',
      name: 'runtime.agent.hook.running',
      timestamp: '2026-04-25T00:00:02.000Z',
      detail: {
        intentId: 'hook-1',
      },
    });
    await Promise.resolve();

    expect(scanNasHandlersMock).toHaveBeenCalledWith('/models/ren/runtime/nimi');
    expect(startNasHandlerHotReloadMock).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'ren',
      nimiDir: '/models/ren/runtime/nimi',
      registry: carrier.registry,
      emit: expect.any(Function),
    }));
    expect(handler.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          event_name: 'runtime.agent.hook.running',
          detail: expect.objectContaining({ intentId: 'hook-1' }),
        }),
      }),
      expect.any(Object),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    carrier.shutdown();
    expect(stopNasHandlerHotReloadMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed and records model error when model manifest resolution fails', async () => {
    resolveModelManifestMock.mockRejectedValue(new Error('no *.model3.json found'));
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();

    await expect(startAvatarRuntimeCarrier({
      driver,
      modelPath: '/models/broken',
    })).rejects.toThrow('no *.model3.json found');

    expect(useAvatarStore.getState().model).toEqual(expect.objectContaining({
      modelPath: '/models/broken',
      loadState: 'error',
      error: 'no *.model3.json found',
    }));
    expect(driver.emitted).toEqual([]);
  });
});
