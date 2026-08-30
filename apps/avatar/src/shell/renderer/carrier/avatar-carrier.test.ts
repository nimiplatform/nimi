import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarDebugProbeKind } from '../avatar-debug/contract.js';
import type { AvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, DriverStatus } from '../driver/types.js';
import { useAvatarStore } from '../app-shell/app-store.js';
import { createLive2DExpressionInventory } from '../live2d/live2d-expression-stack.js';
import { VRM_CAPABILITY_REQUIRED_BONES } from '../vrm/vrm-capability-profile.js';

const resolveModelManifestMock = vi.fn();
const readTextFileMock = vi.fn();
const waitForCubismCoreMock = vi.fn();
const loadOfficialCubismFrameworkRuntimeMock = vi.fn();
const createLive2DBackendSessionMock = vi.fn();
const backendApplyCommandMock = vi.fn();
const backendUnloadMock = vi.fn();
const createVrmBackendBranchMock = vi.fn();

function runtimeEnvelopeDetail(): Record<string, string> {
  return {
    agent_handle: `agent_ref_${'a'.repeat(43)}`,
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

vi.mock('../vrm/vrm-backend.js', () => ({
  createVrmBackendBranch: (...args: unknown[]) => createVrmBackendBranchMock(...args),
}));

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
    active_agent_handle: 'user-1',
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
    waitForCubismCoreMock.mockReset();
    loadOfficialCubismFrameworkRuntimeMock.mockReset();
    createLive2DBackendSessionMock.mockReset();
    backendApplyCommandMock.mockReset();
    backendUnloadMock.mockReset();
    createVrmBackendBranchMock.mockReset();
    waitForCubismCoreMock.mockResolvedValue({ Version: { csmGetVersion: () => 1, csmGetLatestMocVersion: () => 1 } });
    loadOfficialCubismFrameworkRuntimeMock.mockResolvedValue({ CubismFramework: {} });
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

  it('loads a render-only model and ignores activity without an admitted adapter mapping', async () => {
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
        backend_meta: expect.objectContaining({
          compatibility_tier: 'render_only',
        }),
      }),
    });
    expect(commands).toEqual([]);

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
      probe: {
        probeId: 'probe-generated-motion',
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

  it('projects loaded Live2D compatibility, expression, and lipsync facts through the carrier debug-session owner', async () => {
    const adapter = {
      adapter_id: 'ren-semantic',
      semantics: {
        expressions: { map: { happy: 'smile' } },
      },
    };
    createLive2DBackendSessionMock.mockResolvedValueOnce(live2dBackendSession({
      settings: {
        Version: 3,
        FileReferences: { Moc: 'ren.moc3', Textures: [] },
        Groups: [{ Name: 'LipSync', Target: 'Parameter', Ids: ['ParamMouthOpenY'] }],
      },
      compatibility: {
        tier: 'semantic_basic',
        adapter,
        diagnostics: [],
        activityMotionGroups: new Map(),
        idleMotionGroup: 'Idle',
        mouthOpenParameterId: 'ParamMouthOpenY',
        paramMouthFormSupported: false,
        missingActivity: 'diagnostic_no_success',
      },
    }));
    readTextFileMock.mockResolvedValue(JSON.stringify({
      manifest_kind: 'nimi.avatar.live2d.adapter',
      schema_version: 1,
      adapter_id: 'ren-semantic',
      target_model: { model_id: 'ren', model3: 'ren.model3.json' },
      license: { redistribution: 'allowed', evidence: 'local-test', fixture_use: 'committable' },
      compatibility: { requested_tier: 'semantic_basic' },
      semantics: {
        motions: {
          idle: { group: 'Idle' },
          activities: {},
          missing_activity: 'diagnostic_no_success',
        },
        expressions: {
          map: { happy: 'smile' },
          disposition: { status: 'supported', reason: 'mapped expression inventory' },
        },
        poses: { disposition: { status: 'not_applicable', reason: 'not configured' } },
        lipsync: {
          mouth_open_y_parameter: 'ParamMouthOpenY',
          disposition: { status: 'supported', reason: 'declared LipSync parameter' },
        },
        physics: { mode: 'absent', disposition: { status: 'not_applicable', reason: 'not configured' } },
        hit_regions: {
          fallback: 'alpha_mask_only',
          disposition: { status: 'supported', reason: 'canvas alpha probe' },
        },
      },
    }));

    const { startAvatarVisualCarrier } = await import('./avatar-carrier.js');
    const carrier = await startAvatarVisualCarrier({
      modelManifest: live2dManifest({
        adapterManifestPath: '/models/ren/runtime/nimi/live2d-adapter.json',
      }),
    });
    const sessions = [
      AvatarDebugProbeKind.CAPABILITY_PROFILE,
      AvatarDebugProbeKind.EMOTION_EXPRESSION,
      AvatarDebugProbeKind.SPEECH_LIPSYNC,
      AvatarDebugProbeKind.WINDOW_HIT_REGION,
    ].map((probeKind) => carrier.createDebugSession({
      debugSessionId: `live2d-debug-${probeKind}`,
      probe: { probeId: `live2d-probe-${probeKind}`, probeKind },
      avatarInstanceId: 'avatar-live2d-test',
      avatarPackageRef: carrier.model.modelId,
    }));

    expect(sessions.slice(0, 3).map((session) => session.evidence.status)).toEqual([
      'passed',
      'passed',
      'passed',
    ]);
    expect(sessions.slice(0, 3).map((session) => session.evidence.reasonCode ?? '')).toEqual(['', '', '']);
    expect(sessions[3]?.evidence).toMatchObject({
      status: 'failed',
      reasonCode: 'live2d_visual_hit_region_evidence_missing',
    });

    carrier.shutdown();
  });

  it('projects a real typed VRM capability profile through the carrier debug-session owner', async () => {
    const humanoidBones = Object.fromEntries(
      VRM_CAPABILITY_REQUIRED_BONES.map((bone) => [bone, true]),
    );
    const capabilityProfile = {
      profileId: 'vrm-avatar-capability-profile-v1',
      backendKind: 'vrm' as const,
      modelFingerprint: 'vrm:bones=loaded;expr=1',
      humanoidBones,
      expressionManagerPresent: true,
      expressionPresets: { present: true, names: ['happy', 'aa'] },
      lookat: { supported: true },
      poseLimits: { maxRotationDeg: 25 },
      generatedMotion: {
        supportedRoutes: ['idle_subtle', 'nod_yes'],
        unsupportedRoutes: [],
        safetyLimits: { maxRotationRad: 0.436 },
      },
    };
    createVrmBackendBranchMock.mockResolvedValueOnce({
      branch: {
        kind: 'vrm',
        nominalBounds: { width: 360, height: 720 },
        projection: {
          applyActivity() {}, applyEmotion() {}, applyMotion() {}, applyExpression() {}, reset() {},
        },
        surface: { Component: () => null },
        metadata: () => ({ model_kind: 'vrm' }),
        debugFacts: () => ({
          kind: 'vrm',
          capabilityProfile,
          lipsyncProfilePresent: true,
          hitRegionPublished: false,
          visualObservation: null,
        }),
        shutdown() {},
      },
      audioConsumer: {
        async attachAudioSource() {}, detachAudioSource() {}, silent() {}, snapshot: () => null,
      },
      shutdown() {},
    });

    const { startAvatarVisualCarrier } = await import('./avatar-carrier.js');
    const carrier = await startAvatarVisualCarrier({
      modelManifest: {
        kind: 'vrm', modelId: 'alicia', runtimeDir: '/models/alicia', nimiDir: null,
        posterPath: null, vrm: { vrmFile: '/models/alicia/Alicia.vrm', motionPresetsDir: null },
      },
    });
    const sessions = [
      AvatarDebugProbeKind.CAPABILITY_PROFILE,
      AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
      AvatarDebugProbeKind.GENERATED_MOTION,
      AvatarDebugProbeKind.EMOTION_EXPRESSION,
      AvatarDebugProbeKind.SPEECH_LIPSYNC,
      AvatarDebugProbeKind.WINDOW_HIT_REGION,
    ].map((probeKind) => carrier.createDebugSession({
      debugSessionId: `vrm-debug-${probeKind}`,
      probe: { probeId: `vrm-probe-${probeKind}`, probeKind },
      avatarInstanceId: 'avatar-vrm-test',
      avatarPackageRef: carrier.model.modelId,
    }));

    expect(sessions.slice(0, 5).map((session) => session.evidence.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(sessions.slice(0, 5).every((session) => !session.evidence.reasonCode)).toBe(true);
    expect(sessions[5]?.evidence).toMatchObject({
      status: 'failed',
      reasonCode: 'carrier_hit_region_unavailable',
    });

    carrier.shutdown();
  });

  it('shutdown unwires dispatch and unloads the backend', async () => {
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
    carrier.shutdown();
    expect(backendUnloadMock).toHaveBeenCalledTimes(1);

    driver.trigger({
      event_id: 'event-3',
      name: 'runtime.agent.hook.running',
      timestamp: '2026-04-25T00:00:03.000Z',
      detail: { intentId: 'hook-2' },
    });
    await Promise.resolve();
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
