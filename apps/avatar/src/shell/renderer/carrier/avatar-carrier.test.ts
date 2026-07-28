import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarDebugProbeKind, AvatarDebugProbeStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { AvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, DriverStatus } from '../driver/types.js';
import { useAvatarStore } from '../app-shell/app-store.js';
import { createLive2DExpressionInventory } from '../live2d/live2d-expression-stack.js';

const resolveModelManifestMock = vi.fn();
const readTextFileMock = vi.fn();
const scanNasHandlersMock = vi.fn();
const populateRegistryMock = vi.fn();
const startNasHandlerHotReloadMock = vi.fn();
const stopNasHandlerHotReloadMock = vi.fn();
const waitForCubismCoreMock = vi.fn();
const loadOfficialCubismFrameworkRuntimeMock = vi.fn();
const createLive2DBackendSessionMock = vi.fn();
const createLive2DCarrierVisualHostMock = vi.fn();
const backendApplyCommandMock = vi.fn();
const backendUnloadMock = vi.fn();

function runtimeEnvelopeDetail(): Record<string, string> {
  return {
    agent_id: 'local-agent:owner-product:agent-product-01',
    conversation_anchor_id: 'anchor-01',
    turn_id: 'turn-01',
    stream_id: 'stream-01',
  };
}

function expressionInventory() {
  return createLive2DExpressionInventory([
    {
      expressionId: 'smile',
      sourcePath: '/models/ren/runtime/expressions/smile.exp3.json',
      parameters: [
        { id: 'ParamAngleX', value: 1, blend: 'add' },
      ],
    },
  ]);
}

function live2dBackendSession(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      modelId: 'ren',
    },
    settings: {
      Version: 3,
      FileReferences: {
        Moc: 'ren.moc3',
        Textures: [],
      },
    },
    resources: {
      mocPath: '/models/ren/runtime/ren.moc3',
      texturePaths: [],
      motionGroups: new Map(),
      expressions: new Map([
        ['smile', '/models/ren/runtime/expressions/smile.exp3.json'],
      ]),
      physicsPath: null,
      posePath: null,
      displayInfoPath: null,
    },
    expressionInventory: expressionInventory(),
    execution: {
      loaded: true,
      activeMotion: null,
      activeExpression: null,
      activePose: null,
      parameters: new Map(),
      parameterLanes: {
        speechLipsync: new Map(),
        live2dExtensionDirect: new Map(),
      },
      commandLog: [],
    },
    applyCommand: (...args: unknown[]) => backendApplyCommandMock(...args),
    unload: (...args: unknown[]) => backendUnloadMock(...args),
    compatibility: {
      tier: 'render_only',
      adapter: null,
      diagnostics: [],
      activityMotionGroups: new Map(),
      idleMotionGroup: 'Idle',
      mouthOpenParameterId: 'ParamMouthOpenY',
      paramMouthFormSupported: false,
      missingActivity: 'idle_degraded_with_diagnostic',
    },
    ...overrides,
  };
}

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

vi.mock('../live2d/carrier-visual-host.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../live2d/carrier-visual-host.js')>();
  return {
    ...actual,
    createLive2DCarrierVisualHost: (...args: unknown[]) =>
      createLive2DCarrierVisualHostMock(...args),
  };
});

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

function live2dManifest(input: {
  modelId?: string;
  runtimeDir?: string;
  nimiDir?: string | null;
  adapterManifestPath?: string | null;
} = {}): AvatarModelManifest {
  const runtimeDir = input.runtimeDir ?? '/models/ren/runtime';
  const modelId = input.modelId ?? 'ren';
  return {
    kind: 'live2d',
    runtimeDir,
    modelId,
    nimiDir: input.nimiDir ?? null,
    posterPath: null,
    live2d: {
      modelJson: `${runtimeDir}/${modelId}.model3.json`,
      adapterManifestPath: input.adapterManifestPath ?? null,
      calibrationRef: null,
    },
  };
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
    createLive2DCarrierVisualHostMock.mockReset();
    backendApplyCommandMock.mockReset();
    backendUnloadMock.mockReset();
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
    createLive2DCarrierVisualHostMock.mockResolvedValue({
      canvas: {
        toDataURL: vi.fn(() => 'data:image/png;base64,carrier-preview'),
      },
      probeVisibleFrame: vi.fn(() => ({
        width: 360,
        height: 480,
        drawableCount: 1,
        visibleDrawableCount: 1,
        nonZeroOpacityDrawableCount: 1,
        textureBindingCount: 1,
        activeMotionGroup: null,
        motionFrameApplied: false,
        activeExpressionId: null,
        expressionFrameApplied: false,
        parameterLaneOrder: ['speech_lipsync', 'live2d_extension_direct'],
        parameterLaneApplied: [],
        parameterLaneElapsedMs: 0.2,
        parameterLaneUnsupportedParameterIds: [],
        parameterLaneSpeechLipsyncParameterCount: 0,
        parameterLaneDirectParameterCount: 0,
        lookAtIdleSupported: true,
        lookAtIdleBlinkSupported: true,
        lookAtIdleReasonCode: 'ready',
        lookAtIdleParameterIds: [],
        sampledPixels: 16,
        visiblePixels: 8,
        sampledPixelChecksum: 123,
      })),
      drawFrame: vi.fn(),
      resize: vi.fn(),
      unload: vi.fn(),
    });
    createLive2DBackendSessionMock.mockResolvedValue(live2dBackendSession({
      compatibility: {
        tier: 'render_only',
        adapter: null,
        diagnostics: [],
        activityMotionGroups: new Map(),
        idleMotionGroup: 'Idle',
        mouthOpenParameterId: 'ParamMouthOpenY',
        paramMouthFormSupported: false,
        missingActivity: 'idle_degraded_with_diagnostic',
      },
    }));
  });

  it('loads an embedded Live2D adapter manifest and passes compatibility into the backend session', async () => {
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
      modelManifest: live2dManifest({
        nimiDir: '/models/ren/runtime/nimi',
        adapterManifestPath: '/models/ren/runtime/nimi/live2d-adapter.json',
      }),
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
      modelManifest: live2dManifest(),
    });
    backendApplyCommandMock.mockClear();

    driver.trigger({
      event_id: 'event-1',
      name: 'runtime.agent.presentation.activity_requested',
      timestamp: '2026-04-25T00:00:01.000Z',
      detail: {
        activity_name: 'happy',
        category: 'emotion',
        intensity: 'moderate',
        source: 'apml_output',
        ...runtimeEnvelopeDetail(),
      },
    });
    await Promise.resolve();
    const commands: string[] = backendApplyCommandMock.mock.calls
      .map((call) => call[0] as { kind: string; group?: string })
      .filter((command) => command.kind === 'motion')
      .map((command) => command.group ?? '');

    expect(scanNasHandlersMock).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().model).toEqual(expect.objectContaining({
      modelPath: '/models/ren/runtime',
      modelId: 'ren',
      loadState: 'loaded',
      error: null,
    }));
    expect(driver.emitted).toContainEqual({
      name: 'avatar.model.load',
      detail: expect.objectContaining({
        model_id: 'ren',
        model_kind: 'live2d',
        nas_handler_count: 0,
        backend_meta: expect.objectContaining({
          compatibility_tier: 'render_only',
        }),
      }),
    });
    expect(commands).toEqual(['Activity_Happy']);

    carrier.shutdown();
  });

  it('uses adapter manifest motion mapping for Live2D fallback before convention names', async () => {
    createLive2DBackendSessionMock.mockResolvedValueOnce(live2dBackendSession({
      compatibility: {
        tier: 'semantic_basic',
        adapter: { adapter_id: 'ren-basic' },
        diagnostics: [],
        activityMotionGroups: new Map([
          ['greet', { group: 'RenWave' }],
        ]),
        idleMotionGroup: 'RenIdle',
        mouthOpenParameterId: 'ParamMouthOpenY',
        paramMouthFormSupported: false,
        missingActivity: 'diagnostic_no_success',
      },
    }));
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelManifest: live2dManifest(),
    });
    backendApplyCommandMock.mockClear();

    driver.trigger({
      event_id: 'event-adapter-greet',
      name: 'runtime.agent.presentation.activity_requested',
      timestamp: '2026-04-25T00:00:01.000Z',
      detail: {
        activity_name: 'greet',
        category: 'interaction',
        intensity: 'moderate',
        source: 'apml_output',
        ...runtimeEnvelopeDetail(),
      },
    });
    await Promise.resolve();
    const commands: string[] = backendApplyCommandMock.mock.calls
      .map((call) => call[0] as { kind: string; group?: string })
      .filter((command) => command.kind === 'motion')
      .map((command) => command.group ?? '');

    expect(commands).toEqual(['RenWave']);

    carrier.shutdown();
  });

  it('creates Avatar debug session evidence from the active backend without Runtime status ownership', async () => {
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelManifest: live2dManifest(),
    });

    const session = carrier.createDebugSession({
      debugSessionId: 'debug-session-live2d',
      runtimeProbe: {
        probeId: 'probe-generated-motion',
        agentId: 'agent-1',
        probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
      },
      avatarPackageRef: 'avatar-package-ref-1',
      backendCapabilityProfileRef: 'profile-ref-1',
      resolverEvidence: {
        packageResolved: true,
        capabilityProfileResolved: true,
      },
      observedAt: '2026-05-01T00:00:00.000Z',
    });

    expect(session.backendKind).toBe('live2d');
    expect(session.evidence).toMatchObject({
      evidenceKind: 'generated_motion_checked',
      status: 'unsupported',
      reasonCode: 'generated_motion_not_supported_by_backend',
    });

    carrier.shutdown();
  });

  it('submits Runtime avatar debug probe results from the active backend session', async () => {
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const submitDebugProbeResult = vi.fn(async () => {});
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelManifest: live2dManifest(),
      submitDebugProbeResult,
    });

    driver.trigger({
      event_id: 'event-debug-probe',
      name: 'runtime.agent.avatar_debug.probe_requested',
      timestamp: '2026-05-01T00:00:00.000Z',
      detail: {
        probeId: 'probe-runtime-1',
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
        probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
        avatarInstanceId: 'avatar-1',
      },
    });

    expect(submitDebugProbeResult).toHaveBeenCalledWith(expect.objectContaining({
      probeId: 'probe-runtime-1',
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
      status: AvatarDebugProbeStatus.PASSED,
    }));

    carrier.shutdown();
  });

  it('skips non Avatar-submittable Runtime avatar debug probe requests', async () => {
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const submitDebugProbeResult = vi.fn(async () => {});
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelManifest: live2dManifest(),
      submitDebugProbeResult,
    });

    driver.trigger({
      event_id: 'event-debug-probe-package-validation',
      name: 'runtime.agent.avatar_debug.probe_requested',
      timestamp: '2026-05-01T00:00:00.000Z',
      detail: {
        probeId: 'probe-runtime-package-validation',
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
        probeKind: AvatarDebugProbeKind.PACKAGE_VALIDATION,
        avatarInstanceId: 'avatar-1',
      },
    });

    expect(submitDebugProbeResult).not.toHaveBeenCalled();

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
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelManifest: live2dManifest({ nimiDir: '/models/ren/runtime/nimi' }),
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
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();
    const carrier = await startAvatarRuntimeCarrier({
      driver,
      modelManifest: live2dManifest({ nimiDir: '/models/ren/runtime/nimi' }),
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

  // The backend-branch hard cut removes the two
  // carrier tests that exercised the deleted frame_batch consume path
  // and the runtime voice_timing → Live2D mouth bridge are removed. Per-frame
  // mouth movement now flows through BackendAudioConsumer.snapshot() in the
  // surface useFrame loop, written by the wLipSync driver. Regression coverage
  // lives in voice-lipsync/lipsync-e2e.test.ts; normative authority remains in
  // .nimi/spec/avatar/embodiment-surface.authority.yaml.

  it('fails closed and records model error when backend branch creation fails', async () => {
    createLive2DBackendSessionMock.mockRejectedValue(new Error('Live2D backend load failed'));
    const { startAvatarRuntimeCarrier } = await import('./avatar-carrier.js');
    const driver = createDriver();

    await expect(startAvatarRuntimeCarrier({
      driver,
      modelManifest: live2dManifest({
        modelId: 'broken',
        runtimeDir: '/models/broken/runtime',
      }),
    })).rejects.toThrow('Live2D backend load failed');

    expect(useAvatarStore.getState().model).toEqual(expect.objectContaining({
      modelPath: '/models/broken/runtime',
      loadState: 'error',
      error: 'Live2D backend load failed',
    }));
    expect(driver.emitted).toEqual([]);
  });
});
