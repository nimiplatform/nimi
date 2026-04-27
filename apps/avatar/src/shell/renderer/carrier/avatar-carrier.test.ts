import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, DriverStatus } from '../driver/types.js';
import { useAvatarStore } from '../app-shell/app-store.js';

const resolveModelManifestMock = vi.fn();
const readTextFileMock = vi.fn();
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
  readTextFile: (...args: unknown[]) => readTextFileMock(...args),
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
      source: 'runtime_projection',
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
  const eventHandlers = new Set<(event: AgentEvent) => void>();
  const emitted: Array<{ name: string; detail: Record<string, unknown> }> = [];
  const driver: AgentDataDriver & { trigger(event: AgentEvent): void; emitted: typeof emitted } = {
    kind: 'sdk',
    status: 'running' as DriverStatus,
    async start() {},
    async stop() {},
    getBundle: () => createBundle(),
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => {
        eventHandlers.delete(handler);
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
      eventHandlers.forEach((handler) => handler(event));
    },
    emitted,
  };
  return driver;
}

describe('avatar runtime carrier', () => {
  beforeEach(() => {
    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    resolveModelManifestMock.mockReset();
    readTextFileMock.mockReset();
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
      adapterManifestPath: null,
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
      compatibility: {
        tier: 'render_only',
        adapter: null,
        diagnostics: [],
        activityMotionGroups: new Map(),
        idleMotionGroup: 'Idle',
        mouthOpenParameterId: 'ParamMouthOpenY',
        missingActivity: 'idle_degraded_with_diagnostic',
      },
    });
  });

  it('loads an embedded Live2D adapter manifest and passes compatibility into the backend session', async () => {
    resolveModelManifestMock.mockResolvedValue({
      runtimeDir: '/models/ren/runtime',
      modelId: 'ren',
      model3JsonPath: '/models/ren/runtime/ren.model3.json',
      nimiDir: '/models/ren/runtime/nimi',
      adapterManifestPath: '/models/ren/runtime/nimi/live2d-adapter.json',
    });
    readTextFileMock.mockResolvedValue(JSON.stringify({
      manifest_kind: 'nimi.avatar.live2d.adapter',
      schema_version: 1,
      adapter_id: 'ren-basic',
      target_model: { model_id: 'ren', model3: 'ren.model3.json' },
      license: {
        redistribution: 'allowed',
        evidence: 'synthetic test metadata',
        fixture_use: 'committable',
      },
      compatibility: { requested_tier: 'render_only' },
      semantics: {
        motions: {
          idle: { group: 'Idle' },
          missing_activity: 'idle_degraded_with_diagnostic',
        },
        expressions: { disposition: { status: 'not_applicable', reason: 'render only' } },
        poses: { disposition: { status: 'not_applicable', reason: 'render only' } },
        lipsync: { disposition: { status: 'not_applicable', reason: 'render only' } },
        physics: {
          mode: 'absent',
          disposition: { status: 'not_applicable', reason: 'render only' },
        },
        hit_regions: {
          fallback: 'alpha_mask_only',
          disposition: { status: 'not_applicable', reason: 'render only' },
        },
        nas_fallback: {
          default_idle_motion: 'Idle',
          missing_handler: 'backend_default_with_diagnostic',
        },
      },
    }));

    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelPath: '/models/ren',
    });

    expect(readTextFileMock).toHaveBeenCalledWith('/models/ren/runtime/nimi/live2d-adapter.json');
    expect(createLive2DBackendSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'ren' }),
      expect.objectContaining({
        adapterManifest: expect.objectContaining({ adapter_id: 'ren-basic' }),
      }),
    );

    carrier.shutdown();
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
      name: 'runtime.agent.presentation.activity_requested',
      timestamp: '2026-04-25T00:00:01.000Z',
      detail: {
        activity_name: 'happy',
        category: 'emotion',
        intensity: 'moderate',
        source: 'apml_output',
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
        compatibility_tier: 'render_only',
      }),
    });
    expect(commands).toEqual(['Activity_Happy']);

    unsubscribeCommand();
    carrier.shutdown();
  });

  it('uses adapter manifest motion mapping for Live2D fallback before convention names', async () => {
    createLive2DBackendSessionMock.mockResolvedValueOnce({
      applyCommand: (...args: unknown[]) => backendApplyCommandMock(...args),
      unload: (...args: unknown[]) => backendUnloadMock(...args),
      compatibility: {
        tier: 'semantic_basic',
        adapter: { adapter_id: 'ren-basic' },
        diagnostics: [],
        activityMotionGroups: new Map([
          ['greet', { group: 'RenWave' }],
        ]),
        idleMotionGroup: 'RenIdle',
        mouthOpenParameterId: 'ParamMouthOpenY',
        missingActivity: 'diagnostic_no_success',
      },
    });
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
      event_id: 'event-adapter-greet',
      name: 'runtime.agent.presentation.activity_requested',
      timestamp: '2026-04-25T00:00:01.000Z',
      detail: {
        activity_name: 'greet',
        category: 'interaction',
        intensity: 'moderate',
        source: 'apml_output',
      },
    });
    await Promise.resolve();

    expect(commands).toEqual(['RenWave']);

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

  it('shutdown unwires dispatch, cancels in-flight handlers, stops hot reload, and unloads backend', async () => {
    const observedSignal: { current: AbortSignal | null } = { current: null };
    const handler = {
      execute: vi.fn((_ctx: AgentDataBundle, _projection: unknown, options: { signal: AbortSignal }) => {
        observedSignal.current = options.signal;
        return new Promise<void>(() => {});
      }),
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
      detail: { intentId: 'hook-1' },
    });
    await Promise.resolve();
    expect(handler.execute).toHaveBeenCalledOnce();

    carrier.shutdown();
    expect(observedSignal.current?.aborted).toBe(true);
    expect(stopNasHandlerHotReloadMock).toHaveBeenCalledTimes(1);
    expect(backendUnloadMock).toHaveBeenCalledTimes(1);

    driver.trigger({
      event_id: 'event-3',
      name: 'runtime.agent.hook.running',
      timestamp: '2026-04-25T00:00:03.000Z',
      detail: { intentId: 'hook-2' },
    });
    await Promise.resolve();
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it('maps runtime-owned voice timing to Live2D mouth parameters without Avatar synthesizing timeline truth', async () => {
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelPath: '/models/ren',
    });

    driver.trigger({
      event_id: 'event-voice-1',
      name: 'runtime.agent.turn.text_delta',
      timestamp: '2026-04-25T00:00:03.000Z',
      detail: {
        turn_id: 'turn-voice-1',
        stream_id: 'stream-voice-1',
        runtime_timeline: {
          turn_id: 'turn-voice-1',
          stream_id: 'stream-voice-1',
          channel: 'text',
          offset_ms: 0,
          sequence: 1,
          started_at_wall: '2026-04-25T00:00:02.900Z',
          observed_at_wall: '2026-04-25T00:00:03.000Z',
          timebase_owner: 'runtime',
          projection_rule_id: 'K-AGCORE-051',
          clock_basis: 'monotonic_with_wall_anchor',
          provider_neutral: true,
          app_local_authority: false,
        },
        voice_timing: {
          adapter_id: 'runtime.voice.timeline-levels',
          frames: [
            { offset_ms: 0, mouth_open_y: 0.12 },
            { offset_ms: 80, mouth_open_y: 0.86 },
            { offset_ms: 160, mouth_open_y: 0.33 },
          ],
        },
      },
    });
    await Promise.resolve();

    const mouthCommands = backendApplyCommandMock.mock.calls
      .map((call) => call[0])
      .filter((command) => command.kind === 'parameter' && command.id === 'ParamMouthOpenY');
    expect(mouthCommands.map((command) => command.value)).toEqual([0.12, 0.86, 0.33, 0]);
    expect(new Set(mouthCommands.map((command) => command.value)).size).toBeGreaterThan(2);
    expect(driver.emitted.map((event) => event.name)).toEqual(expect.arrayContaining([
      'avatar.speak.start',
      'avatar.lipsync.frame',
      'avatar.speak.end',
    ]));
    expect(driver.emitted.find((event) => event.name === 'avatar.speak.start')?.detail).toEqual(expect.objectContaining({
      turn_id: 'turn-voice-1',
      stream_id: 'stream-voice-1',
      runtime_timeline: expect.objectContaining({
        timebase_owner: 'runtime',
        app_local_authority: false,
      }),
    }));

    carrier.shutdown();
  });

  it('maps runtime presentation lipsync frame batches to Live2D mouth parameters on the carrier path', async () => {
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelPath: '/models/ren',
    });

    driver.trigger({
      event_id: 'event-lipsync-1',
      name: 'runtime.agent.presentation.lipsync_frame_batch',
      timestamp: '2026-04-25T00:00:03.200Z',
      detail: {
        turn_id: 'turn-voice-2',
        stream_id: 'stream-voice-2',
        runtime_timeline: {
          turn_id: 'turn-voice-2',
          stream_id: 'stream-voice-2',
          channel: 'lipsync',
          offset_ms: 0,
          sequence: 2,
          started_at_wall: '2026-04-25T00:00:03.100Z',
          observed_at_wall: '2026-04-25T00:00:03.200Z',
          timebase_owner: 'runtime',
          projection_rule_id: 'K-AGCORE-051',
          clock_basis: 'monotonic_with_wall_anchor',
          provider_neutral: true,
          app_local_authority: false,
        },
        audioArtifactId: 'artifact-runtime-voice-2',
        frames: [
          { frameSequence: 1, offsetMs: 0, durationMs: 80, mouthOpenY: 0.18, audioLevel: 0.12 },
          { frameSequence: 2, offsetMs: 80, durationMs: 90, mouthOpenY: 0.91, audioLevel: 0.72 },
          { frameSequence: 3, offsetMs: 170, durationMs: 70, mouthOpenY: 0.27, audioLevel: 0.2 },
        ],
      },
    });
    await Promise.resolve();

    const mouthCommands = backendApplyCommandMock.mock.calls
      .map((call) => call[0])
      .filter((command) => command.kind === 'parameter' && command.id === 'ParamMouthOpenY');
    expect(mouthCommands.map((command) => command.value)).toEqual([0.18, 0.91, 0.27, 0]);
    expect(driver.emitted.find((event) => event.name === 'avatar.speak.start')?.detail).toEqual(expect.objectContaining({
      turn_id: 'turn-voice-2',
      stream_id: 'stream-voice-2',
      audio_artifact_id: 'artifact-runtime-voice-2',
      runtime_timeline: expect.objectContaining({
        channel: 'lipsync',
        timebase_owner: 'runtime',
        app_local_authority: false,
      }),
    }));
    expect(driver.emitted.map((event) => event.name)).toEqual(expect.arrayContaining([
      'avatar.speak.start',
      'avatar.lipsync.frame',
      'avatar.speak.end',
    ]));

    carrier.shutdown();
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
