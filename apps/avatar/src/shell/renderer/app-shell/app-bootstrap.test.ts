import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReasonCode } from '@nimiplatform/sdk/runtime/generated';
import type { AgentDataBundle, AgentDataDriver, DriverStatus } from '../driver/types.js';
import { useAvatarStore } from './app-store.js';

let driverKind: 'sdk' | 'mock' = 'sdk';
let runtimeBridgeHost: 'tauri' | 'electron' = 'tauri';
const createDriverMock = vi.fn();
const getAvatarLaunchContextMock = vi.fn();
const getRuntimeDefaultsMock = vi.fn();
const getDaemonStatusMock = vi.fn();
const startDaemonMock = vi.fn();
const hasTauriInvokeMock = vi.fn();
const onShellReadyMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const bindAvatarRuntimeIdentityMock = vi.fn();
const driverStopMock = vi.fn();
const createNimiClientMock = vi.fn();
const runtimeReadyMock = vi.fn();
const registerAppMock = vi.fn();
const openSessionMock = vi.fn();
const authorizeExternalPrincipalMock = vi.fn();
const getAccountSessionStatusMock = vi.fn();
const getAccessTokenMock = vi.fn();
const openAnchorMock = vi.fn();
const getAnchorSnapshotMock = vi.fn();
const resolveAvatarLiveInstanceMock = vi.fn();
const getSessionSnapshotMock = vi.fn();
const subscribeTurnsMock = vi.fn();
const requestCompanionParticipationMock = vi.fn();
const cancelCompanionParticipationMock = vi.fn();
const sendAppMessageMock = vi.fn();
const subscribeAppMessagesMock = vi.fn();
const subscribeAgentEventsMock = vi.fn();
const submitScenarioJobMock = vi.fn();
const getScenarioJobMock = vi.fn();
const cancelScenarioJobMock = vi.fn();
const subscribeScenarioJobEventsMock = vi.fn();
const getScenarioArtifactsMock = vi.fn();
const resolveLocalAvatarAssetManifestMock = vi.fn();
const startAvatarRuntimeCarrierMock = vi.fn();
const carrierShutdownMock = vi.fn();
const recordAvatarEvidenceEventuallyMock = vi.fn();

const runtimeMock = {
  ready: (...args: unknown[]) => runtimeReadyMock(...args),
  auth: {
    registerApp: (...args: unknown[]) => registerAppMock(...args),
    openSession: (...args: unknown[]) => openSessionMock(...args),
  },
  grants: {
    authorizeExternalPrincipal: (...args: unknown[]) => authorizeExternalPrincipalMock(...args),
  },
  account: {
    getAccountSessionStatus: (...args: unknown[]) => getAccountSessionStatusMock(...args),
    getAccessToken: (...args: unknown[]) => getAccessTokenMock(...args),
  },
  agents: {
    openConversationAnchor: async (...args: unknown[]) => ({
      snapshot: await openAnchorMock(...args),
    }),
    getConversationAnchorSnapshot: async (...args: unknown[]) => ({
      snapshot: await getAnchorSnapshotMock(...args),
    }),
    resolveAvatarLiveInstanceBinding: (...args: unknown[]) => resolveAvatarLiveInstanceMock(...args),
    getPublicChatSessionSnapshot: async (...args: unknown[]) => ({
      snapshot: await getSessionSnapshotMock(...args),
    }),
    subscribeAgentEvents: (...args: unknown[]) => subscribeAgentEventsMock(...args),
    requestCompanionParticipation: async (...args: unknown[]) => ({
      projection: await requestCompanionParticipationMock(...args),
    }),
    cancelCompanionParticipation: async (...args: unknown[]) => ({
      projection: await cancelCompanionParticipationMock(...args),
    }),
  },
  appMessages: {
    sendAppMessage: (...args: unknown[]) => sendAppMessageMock(...args),
    subscribeAppMessages: (...args: unknown[]) => subscribeAppMessagesMock(...args),
  },
  ai: {
    submitScenarioJob: (...args: unknown[]) => submitScenarioJobMock(...args),
    getScenarioJob: (...args: unknown[]) => getScenarioJobMock(...args),
    cancelScenarioJob: (...args: unknown[]) => cancelScenarioJobMock(...args),
    subscribeScenarioJobEvents: (...args: unknown[]) => subscribeScenarioJobEventsMock(...args),
    getScenarioArtifacts: (...args: unknown[]) => getScenarioArtifactsMock(...args),
  },
};

const RUNTIME_SOURCE_REF = 'agent-launch';
const OWNER_USER_ID = 'account-runtime';
const LOCAL_AGENT_REF = 'local-agent:avatar-opaque-primary';
const OTHER_LOCAL_AGENT_REF = 'local-agent:avatar-opaque-other';
function launchContext(overrides: Partial<{
  agentId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
}> = {}) {
  return {
    agentId: LOCAL_AGENT_REF,
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
    ...overrides,
  };
}

function runtimeAgentContextMatcher() {
  return expect.objectContaining({
    appId: 'nimi.avatar',
    subjectUserId: OWNER_USER_ID,
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
  });
}

function openAnchorRequestMatcher() {
  return expect.objectContaining({
    context: runtimeAgentContextMatcher(),
    localAgentRef: LOCAL_AGENT_REF,
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
  });
}

function anchorSnapshotRequestMatcher(conversationAnchorId: string) {
  return expect.objectContaining({
    context: runtimeAgentContextMatcher(),
    agentId: LOCAL_AGENT_REF,
    conversationAnchorId,
  });
}

function protectedAccessOptionsMatcher() {
  return expect.objectContaining({
    metadata: expect.objectContaining({
      'x-nimi-session-id': 'avatar-app-session-id',
      'x-nimi-session-token': 'avatar-app-session-token',
      'x-nimi-access-token-id': 'avatar-protected-token-id',
      'x-nimi-access-token-secret': 'avatar-protected-token-secret',
    }),
  });
}

function electronHostEquivalenceOptionsMatcher() {
  return expect.objectContaining({
    metadata: {
      'x-nimi-runtime-host-equivalence': 'runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host',
    },
  });
}

function companionParticipationRequestMatcher(
  conversationAnchorId: string,
  extra: Record<string, unknown>,
) {
  return expect.objectContaining({
    context: runtimeAgentContextMatcher(),
    agentId: LOCAL_AGENT_REF,
    conversationAnchorId,
    ...extra,
  });
}

vi.mock('../driver/factory.js', () => ({
  resolveDriverKind: () => driverKind,
  createDriver: (...args: unknown[]) => createDriverMock(...args),
}));

vi.mock('@nimiplatform/sdk', () => ({
  createNimiClient: (...args: unknown[]) => {
    createNimiClientMock(...args);
    return { runtime: runtimeMock };
  },
}));

vi.mock('../mock/scenarios/default.mock.json?raw', () => ({
  default: JSON.stringify({
    scenario_id: 'default',
    agent_bootstrap: {
      active_world_id: 'world-mock-default',
      active_user_id: 'user-mock-default',
    },
  }),
}));

vi.mock('../mock/scenarios/vrm-lifecycle.mock.json?raw', () => ({
  default: JSON.stringify({
    scenario_id: 'vrm-lifecycle',
    agent_bootstrap: {
      active_world_id: 'world-mock-vrm-lifecycle',
      active_user_id: 'user-mock-vrm-lifecycle',
    },
    vrm_lifecycle: {
      model_manifest: {
        kind: 'vrm',
        modelId: 'vrm1-constraint-twist',
        runtimeDir: '.cache/assets/vrm-models',
        nimiDir: null,
        posterPath: null,
        vrm: {
          vrmFile: '.cache/assets/vrm-models/VRM1_Constraint_Twist_Sample.vrm',
          motionPresetsDir: null,
        },
      },
    },
  }),
}));

vi.mock('../carrier/model-resolver.js', () => ({
  resolveLocalAvatarAssetManifest: (...args: unknown[]) =>
    resolveLocalAvatarAssetManifestMock(...args),
}));

vi.mock('../carrier/avatar-carrier.js', () => ({
  startAvatarRuntimeCarrier: (...args: unknown[]) => startAvatarRuntimeCarrierMock(...args),
}));

vi.mock('@renderer/bridge', () => ({
  getAvatarLaunchContext: (...args: unknown[]) => getAvatarLaunchContextMock(...args),
  getRuntimeDefaults: (...args: unknown[]) => getRuntimeDefaultsMock(...args),
  getDaemonStatus: (...args: unknown[]) => getDaemonStatusMock(...args),
  startDaemon: (...args: unknown[]) => startDaemonMock(...args),
  hasTauriInvoke: (...args: unknown[]) => hasTauriInvokeMock(...args),
  installNimiShellRuntimeBridge: () => runtimeBridgeHost === 'electron'
    ? { installed: true, host: 'electron', reason: 'electron-preload-present' }
    : { installed: true, host: 'tauri' },
}));

vi.mock('./tauri-lifecycle.js', () => ({
  isTauriRuntime: () => runtimeBridgeHost === 'tauri',
  onShellReady: (...args: unknown[]) => onShellReadyMock(...args),
}));

vi.mock('./tauri-commands.js', () => ({
  setAlwaysOnTop: (...args: unknown[]) => setAlwaysOnTopMock(...args),
  bindAvatarRuntimeIdentity: (...args: unknown[]) => bindAvatarRuntimeIdentityMock(...args),
}));

vi.mock('./avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) => recordAvatarEvidenceEventuallyMock(...args),
}));

function createFakeDriver(kind: 'sdk' | 'mock'): AgentDataDriver {
  let statusHandler: ((status: DriverStatus) => void) | null = null;
  let bundleHandler: ((bundle: AgentDataBundle) => void) | null = null;
  let currentBundle: AgentDataBundle | null = null;
  let currentStatus: DriverStatus = 'idle';
  return {
    kind,
    get status() {
      return currentStatus;
    },
    async start() {
      currentStatus = 'running';
      statusHandler?.('running');
      currentBundle = {
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
          now: new Date().toISOString(),
          session_id: 'anchor-runtime',
          locale: 'en-US',
        },
        custom: {
          session_status: 'ready',
          transcript_message_count: 0,
          latest_committed_message_id: null,
          latest_committed_turn_id: null,
        },
      };
      bundleHandler?.(currentBundle);
    },
    async stop() {
      driverStopMock();
      statusHandler?.('stopped');
    },
    getBundle() {
      if (!currentBundle) {
        throw new Error('driver bundle is not available before start');
      }
      return currentBundle;
    },
    onEvent() {
      return () => {};
    },
    onBundleChange(handler) {
      bundleHandler = handler;
      return () => {
        bundleHandler = null;
      };
    },
    onStatusChange(handler) {
      statusHandler = handler;
      return () => {
        statusHandler = null;
      };
    },
    emit() {},
  };
}

describe('bootstrapAvatar', () => {
  beforeEach(() => {
    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    driverKind = 'sdk';
    runtimeBridgeHost = 'tauri';
    createDriverMock.mockReset();
    getAvatarLaunchContextMock.mockReset();
    getRuntimeDefaultsMock.mockReset();
    getDaemonStatusMock.mockReset();
    startDaemonMock.mockReset();
    hasTauriInvokeMock.mockReset();
    onShellReadyMock.mockReset();
    setAlwaysOnTopMock.mockReset();
    bindAvatarRuntimeIdentityMock.mockReset();
    driverStopMock.mockReset();
    createNimiClientMock.mockReset();
    runtimeReadyMock.mockReset();
    registerAppMock.mockReset();
    openSessionMock.mockReset();
    authorizeExternalPrincipalMock.mockReset();
    getAccountSessionStatusMock.mockReset();
    getAccessTokenMock.mockReset();
    openAnchorMock.mockReset();
    getAnchorSnapshotMock.mockReset();
    resolveAvatarLiveInstanceMock.mockReset();
    getSessionSnapshotMock.mockReset();
    subscribeTurnsMock.mockReset();
    requestCompanionParticipationMock.mockReset();
    cancelCompanionParticipationMock.mockReset();
    sendAppMessageMock.mockReset();
    subscribeAppMessagesMock.mockReset();
    subscribeAgentEventsMock.mockReset();
    submitScenarioJobMock.mockReset();
    getScenarioJobMock.mockReset();
    cancelScenarioJobMock.mockReset();
    subscribeScenarioJobEventsMock.mockReset();
    getScenarioArtifactsMock.mockReset();
    resolveLocalAvatarAssetManifestMock.mockReset();
    startAvatarRuntimeCarrierMock.mockReset();
    carrierShutdownMock.mockReset();
    recordAvatarEvidenceEventuallyMock.mockReset();
    window.localStorage.clear();
    createDriverMock.mockImplementation((input: { kind: 'sdk' | 'mock' }) => createFakeDriver(input.kind));
    onShellReadyMock.mockResolvedValue(() => {});
    setAlwaysOnTopMock.mockResolvedValue(undefined);
    bindAvatarRuntimeIdentityMock.mockResolvedValue(undefined);
    hasTauriInvokeMock.mockReturnValue(true);
    getAvatarLaunchContextMock.mockResolvedValue(launchContext());
    getDaemonStatusMock.mockResolvedValue({
      running: true,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
    });
    startDaemonMock.mockResolvedValue({
      running: true,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
    });
    getRuntimeDefaultsMock.mockResolvedValue({
      realm: {
        realmBaseUrl: 'http://localhost:3002',
        realtimeUrl: '',
        accessToken: '',
        jwksUrl: 'http://localhost:3002/api/auth/jwks',
        revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
        jwtIssuer: 'http://localhost:3002',
        jwtAudience: 'nimi-runtime',
      },
      runtime: {
        localProviderEndpoint: '',
        localProviderModel: '',
        localOpenAiEndpoint: '',
        connectorId: '',
        targetType: '',
        targetAccountId: '',
        agentId: 'runtime-default-agent',
        worldId: 'world-1',
        provider: '',
        userConfirmedUpload: false,
      },
    });
    runtimeReadyMock.mockResolvedValue(undefined);
    registerAppMock.mockResolvedValue({
      accepted: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      appInstanceId: 'nimi.avatar.local-first-party',
    });
    openSessionMock.mockResolvedValue({
      sessionId: 'avatar-app-session-id',
      sessionToken: 'avatar-app-session-token',
      issuedAt: {
        seconds: String(Math.floor(Date.now() / 1000)),
        nanos: 0,
      },
      expiresAt: {
        seconds: String(Math.floor(Date.now() / 1000) + 3600),
        nanos: 0,
      },
      reasonCode: ReasonCode.ACTION_EXECUTED,
    });
    getAccountSessionStatusMock.mockResolvedValue({
      state: 3,
      accountProjection: { accountId: 'account-runtime' },
    });
    getAccessTokenMock.mockResolvedValue({
      accepted: true,
      accessToken: 'runtime-issued-short-lived-token',
    });
    authorizeExternalPrincipalMock.mockResolvedValue({
      tokenId: 'avatar-protected-token-id',
      secret: 'avatar-protected-token-secret',
      expiresAt: {
        seconds: String(Math.floor(Date.now() / 1000) + 3600),
        nanos: 0,
      },
    });
    openAnchorMock.mockResolvedValue({
      anchor: {
        conversationAnchorId: 'anchor-runtime',
        agentId: LOCAL_AGENT_REF,
        subjectUserId: OWNER_USER_ID,
      },
    });
    getAnchorSnapshotMock.mockResolvedValue({
      anchor: {
        conversationAnchorId: 'anchor-runtime',
        agentId: LOCAL_AGENT_REF,
        subjectUserId: OWNER_USER_ID,
      },
    });
    resolveAvatarLiveInstanceMock.mockRejectedValue(new Error('avatar live instance binding not found'));
    getSessionSnapshotMock.mockResolvedValue({
      sessionStatus: 'ready',
      transcriptMessageCount: 0,
      executionBinding: {
        route: 'local',
        modelId: 'local-model',
      },
    });
    subscribeTurnsMock.mockResolvedValue((async function* emptyStream() {})());
    sendAppMessageMock.mockResolvedValue({
      messageId: 'runtime-turn-interrupt-message',
      accepted: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
    });
    subscribeAppMessagesMock.mockReturnValue((async function* emptyAppMessageStream() {})());
    subscribeAgentEventsMock.mockReturnValue((async function* emptyAgentEventStream() {})());
    resolveLocalAvatarAssetManifestMock.mockResolvedValue({
      kind: 'live2d',
      runtimeDir: '/models/ren/files',
      modelId: 'ren',
      nimiDir: null,
      posterPath: null,
      live2d: {
        modelJson: '/models/ren/files/ren.model3.json',
        adapterManifestPath: null,
        calibrationRef: null,
      },
    });
    startAvatarRuntimeCarrierMock.mockResolvedValue({
      shutdown: carrierShutdownMock,
    });
    requestCompanionParticipationMock.mockResolvedValue({
      projectionId: 'companion_participation_projection/anchor-runtime/avatar_companion/turn-runtime',
      agentId: LOCAL_AGENT_REF,
      surfaceKind: 'avatar_companion',
      profileRef: `runtime.agent.profile/${LOCAL_AGENT_REF}`,
      roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
      triggerSource: 'user_explicit',
      status: 'running',
      auditRef: 'runtime.audit.companion_participation/anchor-runtime',
      conversationAnchorId: 'anchor-runtime',
      turnId: 'turn-runtime',
    });
    cancelCompanionParticipationMock.mockResolvedValue({
      projectionId: 'companion_participation_projection/anchor-runtime/avatar_companion/turn-runtime',
      agentId: LOCAL_AGENT_REF,
      surfaceKind: 'avatar_companion',
      profileRef: `runtime.agent.profile/${LOCAL_AGENT_REF}`,
      roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
      triggerSource: 'user_explicit',
      status: 'canceled',
      auditRef: 'runtime.audit.companion_participation/anchor-runtime',
      conversationAnchorId: 'anchor-runtime',
      turnId: 'turn-runtime',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('bootstraps default Avatar as a local first-party Runtime app from minimal launch intent', async () => {
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAvatarLaunchContextMock).toHaveBeenCalledTimes(1);
    expect(getDaemonStatusMock).toHaveBeenCalledTimes(1);
    expect(startDaemonMock).not.toHaveBeenCalled();
    expect(createNimiClientMock).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'nimi.avatar',
      runtime: expect.objectContaining({
        appId: 'nimi.avatar',
        transport: expect.objectContaining({
          type: 'tauri-ipc',
          commandNamespace: 'runtime_bridge',
          eventNamespace: 'runtime_bridge',
        }),
      }),
    }));
    expect(createNimiClientMock.mock.calls[0]?.[0]).not.toHaveProperty('accessToken');
    expect(createNimiClientMock.mock.calls[0]?.[0]).not.toHaveProperty('refreshTokenProvider');
    expect(registerAppMock).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'nimi.avatar',
      appInstanceId: 'nimi.avatar.local-first-party',
      deviceId: 'avatar-shell-runtime-bridge',
      appVersion: '1',
      capabilities: [],
      developerRegistration: false,
      modeManifest: {
        appMode: 3,
        runtimeRequired: true,
        realmRequired: true,
        worldRelation: 1,
      },
    }), expect.any(Object));
    expect(getAccountSessionStatusMock).toHaveBeenCalledWith({
      caller: expect.objectContaining({
        appId: 'nimi.avatar',
        appInstanceId: 'nimi.avatar.local-first-party',
        mode: 1,
      }),
    });
    expect(getAccessTokenMock).toHaveBeenCalledWith({
      caller: expect.objectContaining({
        appId: 'nimi.avatar',
        appInstanceId: 'nimi.avatar.local-first-party',
        mode: 1,
      }),
      requestedScopes: [],
    });
    expect(getAnchorSnapshotMock).not.toHaveBeenCalled();
    expect(openAnchorMock).toHaveBeenCalledWith(openAnchorRequestMatcher(), protectedAccessOptionsMatcher());
    expect(resolveLocalAvatarAssetManifestMock).toHaveBeenCalledWith({
      accountId: OWNER_USER_ID,
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      localAgentRef: LOCAL_AGENT_REF,
    });
    const localAssetResolvedCall = recordAvatarEvidenceEventuallyMock.mock.calls.find(([payload]) => (
      payload
      && typeof payload === 'object'
      && (payload as Record<string, unknown>).kind === 'avatar.visual.local-asset-resolved'
    ));
    expect(localAssetResolvedCall?.[0]).toEqual(expect.objectContaining({
      kind: 'avatar.visual.local-asset-resolved',
      detail: expect.objectContaining({
        agentId: LOCAL_AGENT_REF,
        avatar_instance_id: 'instance-1',
        conversation_anchor_id: 'anchor-runtime',
        local_asset_ref: 'ren',
        backend_kind: 'live2d',
        asset_authority: 'local_avatar_asset',
        resolver_authority: 'avatar_local_materialization',
        live2d_calibration_ref: null,
        live2d_calibration_projection_status: 'not_configured',
        live2d_calibration_effect_admitted: false,
      }),
    }));
    expect((localAssetResolvedCall?.[0] as { detail?: Record<string, unknown> } | undefined)?.detail).not.toHaveProperty('model3_json_path');
    expect((localAssetResolvedCall?.[0] as { detail?: Record<string, unknown> } | undefined)?.detail).not.toHaveProperty('model_path');
    expect(useAvatarStore.getState().launch.context).toEqual({
      agentId: LOCAL_AGENT_REF,
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      localAgentRef: LOCAL_AGENT_REF,
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
    expect(useAvatarStore.getState().consume.authority).toBe('runtime');
    expect(useAvatarStore.getState().runtime.binding.status).toBe('active');
    expect(useAvatarStore.getState().consume).toEqual(expect.objectContaining({
      avatarInstanceId: 'instance-1',
      agentId: LOCAL_AGENT_REF,
      conversationAnchorId: 'anchor-runtime',
      worldId: '',
    }));
    expect(createDriverMock).toHaveBeenCalledWith({
      kind: 'sdk',
      sdk: expect.objectContaining({
        runtimeAgent: expect.objectContaining({
          anchors: expect.any(Object),
          turns: expect.any(Object),
          companionParticipation: expect.any(Object),
        }),
        withScopes: expect.any(Function),
        ownerUserId: OWNER_USER_ID,
        runtimeSourceRef: RUNTIME_SOURCE_REF,
        localAgentRef: LOCAL_AGENT_REF,
        conversationAnchorId: 'anchor-runtime',
        activeWorldId: '',
        activeUserId: OWNER_USER_ID,
      }),
    });
    expect(startAvatarRuntimeCarrierMock).toHaveBeenCalledWith(expect.objectContaining({
      driver: handle.driver,
      modelManifest: expect.objectContaining({ modelId: 'ren' }),
      submitDebugProbeResult: expect.any(Function),
    }));
    expect(handle.driver).not.toBeNull();
    expect(handle.carrier).not.toBeNull();
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'avatar.runtime.consume-ready',
      detail: expect.objectContaining({
        agentId: LOCAL_AGENT_REF,
        avatar_instance_id: 'instance-1',
        conversation_anchor_id: 'anchor-runtime',
        driver_status: 'running',
        session_id: 'anchor-runtime',
        session_status: 'ready',
      }),
    }));

    await handle.shutdown();
    expect(carrierShutdownMock).toHaveBeenCalledTimes(1);
  });

  it('uses Electron host equivalence for Runtime Agent scopes without renderer-owned auth metadata', async () => {
    runtimeBridgeHost = 'electron';
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(createNimiClientMock).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'nimi.avatar',
      runtime: expect.objectContaining({
        appId: 'nimi.avatar',
        transport: { type: 'electron-ipc' },
      }),
    }));
    expect(openSessionMock).not.toHaveBeenCalled();
    expect(authorizeExternalPrincipalMock).not.toHaveBeenCalled();
    expect(openAnchorMock).toHaveBeenCalledWith(openAnchorRequestMatcher(), electronHostEquivalenceOptionsMatcher());
    const openAnchorOptions = openAnchorMock.mock.calls[0]?.[1] as { metadata?: Record<string, string> } | undefined;
    expect(openAnchorOptions?.metadata).not.toHaveProperty('x-nimi-session-id');
    expect(openAnchorOptions?.metadata).not.toHaveProperty('x-nimi-session-token');
    expect(openAnchorOptions?.metadata).not.toHaveProperty('x-nimi-access-token-id');
    expect(openAnchorOptions?.metadata).not.toHaveProperty('x-nimi-access-token-secret');
    expect(useAvatarStore.getState().runtime.binding.status).toBe('active');

    await handle.shutdown();
  });

  it('routes Avatar companion controls through Runtime companion participation', async () => {
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    await handle.requestCompanionParticipation({
      agentId: LOCAL_AGENT_REF,
      conversationAnchorId: 'anchor-runtime',
      text: 'hello avatar',
    });
    await handle.cancelCompanionParticipation({
      agentId: LOCAL_AGENT_REF,
      conversationAnchorId: 'anchor-runtime',
      turnId: 'turn-runtime',
      reason: 'avatar_voice_interrupt',
    });

    expect(requestCompanionParticipationMock).toHaveBeenCalledWith(companionParticipationRequestMatcher('anchor-runtime', {
      conversationAnchorId: 'anchor-runtime',
      text: 'hello avatar',
    }), undefined);
    expect(cancelCompanionParticipationMock).toHaveBeenCalledWith(companionParticipationRequestMatcher('anchor-runtime', {
      conversationAnchorId: 'anchor-runtime',
      turnId: 'turn-runtime',
      reason: 'avatar_voice_interrupt',
    }), undefined);

    await handle.shutdown();
  });

  it('routes Avatar active-turn interrupt through Runtime turn interrupt', async () => {
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    await handle.interruptActiveTurn({
      agentId: LOCAL_AGENT_REF,
      conversationAnchorId: 'anchor-runtime',
      turnId: 'turn-runtime',
      reason: 'user_cancel',
    });

    expect(sendAppMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      fromAppId: 'nimi.avatar',
      toAppId: 'runtime.agent',
      messageType: 'runtime.agent.turn.interrupt',
      requireAck: false,
    }), expect.anything());
    const payload = sendAppMessageMock.mock.calls[0]?.[0]?.payload as { fields?: Record<string, unknown> };
    expect(JSON.stringify(payload)).toContain('turn-runtime');
    expect(JSON.stringify(payload)).toContain('user_cancel');

    await handle.shutdown();
  });

  it('starts the Runtime daemon before first-party platform bootstrap when it is stopped', async () => {
    getDaemonStatusMock.mockResolvedValue({
      running: false,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
      lastError: 'RUNTIME_BRIDGE_DAEMON_UNAVAILABLE',
    });
    startDaemonMock.mockResolvedValue({
      running: true,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getDaemonStatusMock).toHaveBeenCalledTimes(1);
    expect(startDaemonMock).toHaveBeenCalledTimes(1);
    expect(createNimiClientMock).toHaveBeenCalledTimes(1);
    expect(openAnchorMock).toHaveBeenCalledWith(openAnchorRequestMatcher(), protectedAccessOptionsMatcher());
    expect(useAvatarStore.getState().runtime.binding.status).toBe('active');

    await handle.shutdown();
  });

  it('fails closed before platform bootstrap when the Runtime daemon cannot start', async () => {
    getDaemonStatusMock.mockResolvedValue({
      running: false,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
    });
    startDaemonMock.mockResolvedValue({
      running: false,
      managed: true,
      launchMode: 'INVALID',
      grpcAddr: '127.0.0.1:46371',
      lastError: 'RUNTIME_BRIDGE_DAEMON_START_TIMEOUT',
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(startDaemonMock).toHaveBeenCalledTimes(1);
    expect(createNimiClientMock).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    expect(useAvatarStore.getState().runtime.binding.reason).toBe(
      'runtime_daemon_prepare: RUNTIME_BRIDGE_DAEMON_START_TIMEOUT / start_runtime_daemon',
    );
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'avatar.runtime.bind-failed',
      detail: expect.objectContaining({
        reason: 'runtime_daemon_prepare: RUNTIME_BRIDGE_DAEMON_START_TIMEOUT / start_runtime_daemon',
        error_stage: 'runtime_daemon_prepare',
        error_reason_code: 'RUNTIME_BRIDGE_DAEMON_START_TIMEOUT',
        error_action_hint: 'start_runtime_daemon',
      }),
    }));
    expect(handle.driver).toBeNull();
  });

  it('does not require Desktop package or scoped binding launch fields beyond the Runtime anchor intent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T00:00:00.000Z'));
    getAvatarLaunchContextMock.mockResolvedValue(launchContext({
      avatarInstanceId: null,
      launchSource: null,
    }));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(useAvatarStore.getState().launch.context).toEqual({
      agentId: LOCAL_AGENT_REF,
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      localAgentRef: LOCAL_AGENT_REF,
      avatarInstanceId: null,
      launchSource: null,
    });
    expect(useAvatarStore.getState().runtime.binding.status).toBe('active');
    expect(openAnchorMock).toHaveBeenCalledWith(openAnchorRequestMatcher(), protectedAccessOptionsMatcher());
    expect(useAvatarStore.getState().consume.avatarInstanceId).toBe('avatar-1777420800000');
    expect(createDriverMock).toHaveBeenCalledTimes(1);
    expect(createDriverMock.mock.calls[0]?.[0]?.sdk).not.toHaveProperty('scopedBinding');

    await handle.shutdown();
  });

  it('recovers a persisted Runtime anchor for the selected Avatar instance', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v2', JSON.stringify({
      schemaVersion: 2,
      records: [{
        schemaVersion: 2,
        accountId: OWNER_USER_ID,
        localAgentRef: LOCAL_AGENT_REF,
        avatarInstanceId: 'instance-1',
        conversationAnchorId: 'anchor-recovered',
        updatedAtMs: 1777420800000,
      }],
    }));
    getAnchorSnapshotMock.mockResolvedValue({
      anchor: {
        conversationAnchorId: 'anchor-recovered',
        agentId: LOCAL_AGENT_REF,
        subjectUserId: OWNER_USER_ID,
      },
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).toHaveBeenCalledWith(anchorSnapshotRequestMatcher('anchor-recovered'), protectedAccessOptionsMatcher());
    expect(openAnchorMock).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-recovered');
    expect(window.localStorage.getItem('nimi.avatar.conversation-context.v2')).toContain('anchor-recovered');
    expect(createDriverMock).toHaveBeenCalledWith({
      kind: 'sdk',
      sdk: expect.objectContaining({
        conversationAnchorId: 'anchor-recovered',
        activeUserId: OWNER_USER_ID,
      }),
    });

    await handle.shutdown();
  });

  it('does not reuse persisted anchors across a different Avatar instance', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v2', JSON.stringify({
      schemaVersion: 2,
      records: [{
        schemaVersion: 2,
        accountId: OWNER_USER_ID,
        localAgentRef: LOCAL_AGENT_REF,
        avatarInstanceId: 'instance-other',
        conversationAnchorId: 'anchor-other',
        updatedAtMs: 1777420800000,
      }],
    }));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).not.toHaveBeenCalled();
    expect(openAnchorMock).toHaveBeenCalledWith(openAnchorRequestMatcher(), protectedAccessOptionsMatcher());
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-runtime');

    await handle.shutdown();
  });

  it('drops invalid persisted anchors and opens a Runtime-owned replacement', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v2', JSON.stringify({
      schemaVersion: 2,
      records: [{
        schemaVersion: 2,
        accountId: OWNER_USER_ID,
        localAgentRef: LOCAL_AGENT_REF,
        avatarInstanceId: 'instance-1',
        conversationAnchorId: 'anchor-stale',
        updatedAtMs: 1777420800000,
      }],
    }));
    getAvatarLaunchContextMock.mockResolvedValue(launchContext());
    getAnchorSnapshotMock.mockResolvedValue({
      anchor: {
        conversationAnchorId: 'anchor-stale',
        agentId: LOCAL_AGENT_REF,
        subjectUserId: 'other-account',
      },
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).toHaveBeenCalledWith(anchorSnapshotRequestMatcher('anchor-stale'), protectedAccessOptionsMatcher());
    expect(openAnchorMock).toHaveBeenCalledWith(openAnchorRequestMatcher(), protectedAccessOptionsMatcher());
    expect(useAvatarStore.getState().runtime.binding.status).toBe('active');
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-runtime');
    expect(window.localStorage.getItem('nimi.avatar.conversation-context.v2')).toContain('anchor-runtime');

    await handle.shutdown();
  });

  it('keeps same-agent Avatar instances isolated by avatarInstanceId', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v2', JSON.stringify({
      schemaVersion: 2,
      records: [
        {
          schemaVersion: 2,
          accountId: OWNER_USER_ID,
          localAgentRef: LOCAL_AGENT_REF,
          avatarInstanceId: 'instance-1',
          conversationAnchorId: 'anchor-instance-1',
          updatedAtMs: 1777420800000,
        },
        {
          schemaVersion: 2,
          accountId: OWNER_USER_ID,
          localAgentRef: LOCAL_AGENT_REF,
          avatarInstanceId: 'instance-2',
          conversationAnchorId: 'anchor-instance-2',
          updatedAtMs: 1777420800001,
        },
      ],
    }));
    getAvatarLaunchContextMock.mockResolvedValue(launchContext({
      avatarInstanceId: 'instance-2',
    }));
    getAnchorSnapshotMock.mockResolvedValue({
      anchor: {
        conversationAnchorId: 'anchor-instance-2',
        agentId: LOCAL_AGENT_REF,
        subjectUserId: OWNER_USER_ID,
      },
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).toHaveBeenCalledWith(anchorSnapshotRequestMatcher('anchor-instance-2'), protectedAccessOptionsMatcher());
    expect(useAvatarStore.getState().consume.avatarInstanceId).toBe('instance-2');
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-instance-2');
    expect(openAnchorMock).not.toHaveBeenCalled();

    await handle.shutdown();
  });

  it('keeps different-agent Avatar instances isolated by agentId', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v2', JSON.stringify({
      schemaVersion: 2,
      records: [{
        schemaVersion: 2,
        accountId: OWNER_USER_ID,
        localAgentRef: OTHER_LOCAL_AGENT_REF,
        avatarInstanceId: 'instance-1',
        conversationAnchorId: 'anchor-other-agent',
        updatedAtMs: 1777420800000,
      }],
    }));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).not.toHaveBeenCalled();
    expect(openAnchorMock).toHaveBeenCalledWith(openAnchorRequestMatcher(), protectedAccessOptionsMatcher());
    expect(useAvatarStore.getState().consume.agentId).toBe(LOCAL_AGENT_REF);
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-runtime');

    await handle.shutdown();
  });

  it('surfaces missing Runtime auth as a typed first-party product state', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: 1,
      accountProjection: null,
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    expect(useAvatarStore.getState().runtime.binding.reason).toBe('runtime_account_session_unavailable');
    expect(getAccessTokenMock).not.toHaveBeenCalled();
    expect(openAnchorMock).not.toHaveBeenCalled();
    expect(createDriverMock).not.toHaveBeenCalled();
    expect(handle.driver).toBeNull();

    await handle.shutdown();
  });

  it('fails closed before account status when Avatar Runtime app registration is rejected', async () => {
    registerAppMock.mockResolvedValue({
      accepted: false,
      reasonCode: ReasonCode.APP_AUTHORIZATION_DENIED,
      appInstanceId: '',
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    expect(useAvatarStore.getState().runtime.binding.reason).toBe(
      'runtime_app_registration: APP_AUTHORIZATION_DENIED / register_runtime_app_first',
    );
    expect(getAccountSessionStatusMock).not.toHaveBeenCalled();
    expect(getAccessTokenMock).not.toHaveBeenCalled();
    expect(openAnchorMock).not.toHaveBeenCalled();
    expect(createDriverMock).not.toHaveBeenCalled();
    expect(handle.driver).toBeNull();

    await handle.shutdown();
  });

  it('surfaces first-party Runtime bootstrap stage when Runtime anchor validation fails authorization', async () => {
    openAnchorMock.mockRejectedValue(Object.assign(new Error('permission denied'), {
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'check_runtime_bridge_and_daemon',
      source: 'runtime',
      retryable: true,
    }));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    expect(useAvatarStore.getState().runtime.binding.reason).toBe(
      'conversation_context: PRINCIPAL_UNAUTHORIZED / check_runtime_bridge_and_daemon',
    );
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'avatar.runtime.bind-failed',
      detail: expect.objectContaining({
        reason: 'conversation_context: PRINCIPAL_UNAUTHORIZED / check_runtime_bridge_and_daemon',
        error_stage: 'conversation_context',
        error_reason_code: 'PRINCIPAL_UNAUTHORIZED',
        error_action_hint: 'check_runtime_bridge_and_daemon',
        error_source: 'runtime',
        error_retryable: true,
      }),
    }));
    expect(createDriverMock).not.toHaveBeenCalled();
    expect(handle.driver).toBeNull();

    await handle.shutdown();
  });

  it('fails closed with typed local Avatar asset diagnostics after Runtime anchor recovery', async () => {
    resolveLocalAvatarAssetManifestMock.mockRejectedValue(
      new Error('selected local Avatar asset entry file is missing'),
    );
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(bindAvatarRuntimeIdentityMock).toHaveBeenCalledTimes(1);
    expect(createDriverMock).not.toHaveBeenCalled();
    expect(startAvatarRuntimeCarrierMock).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().consume).toEqual(expect.objectContaining({
      avatarInstanceId: 'instance-1',
      conversationAnchorId: 'anchor-runtime',
      agentId: LOCAL_AGENT_REF,
    }));
    expect(useAvatarStore.getState().runtime.binding).toEqual(expect.objectContaining({
      status: 'unavailable',
      reason: 'local_avatar_asset_manifest: LOCAL_AVATAR_ASSET_RESOLVE_FAILED / reimport_or_select_local_avatar_asset',
      reasonCode: 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED',
      actionHint: 'reimport_or_select_local_avatar_asset',
      stage: 'local_avatar_asset_manifest',
      source: 'avatar_local_materialization',
      retryable: false,
    }));
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'avatar.runtime.bind-failed',
      detail: expect.objectContaining({
        agentId: LOCAL_AGENT_REF,
        avatar_instance_id: 'instance-1',
        conversation_anchor_id: 'anchor-runtime',
        reason: 'local_avatar_asset_manifest: LOCAL_AVATAR_ASSET_RESOLVE_FAILED / reimport_or_select_local_avatar_asset',
        error_stage: 'local_avatar_asset_manifest',
        error_reason_code: 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED',
        error_action_hint: 'reimport_or_select_local_avatar_asset',
        error_source: 'avatar_local_materialization',
        error_retryable: false,
        error_message: 'selected local Avatar asset entry file is missing',
      }),
    }));
    expect(handle.driver).toBeNull();
    expect(handle.carrier).toBeNull();

    await handle.shutdown();
  });

  it('fails closed when driver start hangs before Runtime consume is ready', async () => {
    vi.useFakeTimers();
    createDriverMock.mockReturnValue({
      ...createFakeDriver('sdk'),
      start: vi.fn(() => new Promise(() => {})),
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const bootstrap = bootstrapAvatar();
    await vi.advanceTimersByTimeAsync(12_000);
    await Promise.resolve();
    const handle = await bootstrap;

    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    expect(useAvatarStore.getState().runtime.binding.reason).toBe(
      'driver_start: driver_start timed out after 12000ms',
    );
    expect(startAvatarRuntimeCarrierMock).toHaveBeenCalledTimes(1);
    expect(carrierShutdownMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().driver.status).toBe('error');
    expect(handle.driver).toBeNull();
    expect(handle.carrier).toBeNull();

    await handle.shutdown();
  });

  it('fails closed for default mock fixture when no visual model manifest is declared', async () => {
    driverKind = 'mock';
    createDriverMock.mockReturnValue(createFakeDriver('mock'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(createDriverMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'mock',
      scenarioSource: 'default.mock.json',
    }));
    expect(startAvatarRuntimeCarrierMock).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().consume).toEqual(expect.objectContaining({
      mode: 'mock',
      authority: 'fixture',
      fixtureId: 'default',
      fixturePlaying: true,
      avatarInstanceId: 'fixture-avatar-default',
      conversationAnchorId: 'fixture-anchor-default',
      agentId: 'fixture-agent-default',
      worldId: 'world-mock-default',
    }));
    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    expect(useAvatarStore.getState().model).toEqual(expect.objectContaining({
      loadState: 'error',
      error: 'mock fixture "default" does not declare a visual model manifest',
    }));

    await handle.shutdown();
  });

  it('starts visual carrier for explicit mock fixture with a model manifest', async () => {
    driverKind = 'mock';
    vi.stubEnv('VITE_AVATAR_MOCK_SCENARIO', 'vrm-lifecycle');
    createDriverMock.mockReturnValue(createFakeDriver('mock'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(createDriverMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'mock',
      scenarioSource: 'vrm-lifecycle.mock.json',
    }));
    expect(startAvatarRuntimeCarrierMock).toHaveBeenCalledWith(expect.objectContaining({
      driver: handle.driver,
      modelManifest: expect.objectContaining({
        kind: 'vrm',
        modelId: 'vrm1-constraint-twist',
        runtimeDir: expect.stringContaining('.cache/assets/vrm-models'),
        vrm: expect.objectContaining({
          vrmFile: expect.stringContaining('VRM1_Constraint_Twist_Sample.vrm'),
        }),
      }),
    }));
    expect(useAvatarStore.getState().consume).toEqual(expect.objectContaining({
      mode: 'mock',
      authority: 'fixture',
      fixtureId: 'vrm-lifecycle',
      fixturePlaying: true,
      avatarInstanceId: 'fixture-avatar-vrm-lifecycle',
      conversationAnchorId: 'fixture-anchor-vrm-lifecycle',
      agentId: 'fixture-agent-vrm-lifecycle',
      worldId: 'world-mock-vrm-lifecycle',
    }));
    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');

    await handle.shutdown();
  });

  it('fails closed when desktop launch context is missing', async () => {
    vi.useFakeTimers();
    getAvatarLaunchContextMock.mockRejectedValue(
      new Error('avatar launch context is required; launch from desktop orchestrator'),
    );
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const bootstrap = bootstrapAvatar();
    const assertion = expect(bootstrap).rejects.toThrow(
      'avatar launch context was not bound within 5000ms',
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });
});
