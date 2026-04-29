import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, DriverStatus } from '../driver/types.js';
import { useAvatarStore } from './app-store.js';

let driverKind: 'sdk' | 'mock' = 'sdk';
const createDriverMock = vi.fn();
const getAvatarLaunchContextMock = vi.fn();
const getRuntimeDefaultsMock = vi.fn();
const getDaemonStatusMock = vi.fn();
const startDaemonMock = vi.fn();
const hasTauriInvokeMock = vi.fn();
const onShellReadyMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const driverStopMock = vi.fn();
const createLocalFirstPartyRuntimePlatformClientMock = vi.fn();
const getAccountSessionStatusMock = vi.fn();
const getAccessTokenMock = vi.fn();
const openAnchorMock = vi.fn();
const getAnchorSnapshotMock = vi.fn();
const getSessionSnapshotMock = vi.fn();
const subscribeTurnsMock = vi.fn();
const requestTurnMock = vi.fn();
const interruptTurnMock = vi.fn();
const transcribeMock = vi.fn();
const listRouteOptionsMock = vi.fn();
const checkRouteHealthMock = vi.fn();
const resolveAgentCenterAvatarPackageManifestMock = vi.fn();
const startAvatarRuntimeCarrierMock = vi.fn();
const carrierShutdownMock = vi.fn();
const recordAvatarEvidenceEventuallyMock = vi.fn();

const runtimeMock = {
  account: {
    getAccountSessionStatus: (...args: unknown[]) => getAccountSessionStatusMock(...args),
    getAccessToken: (...args: unknown[]) => getAccessTokenMock(...args),
  },
  agent: {
    anchors: {
      open: (...args: unknown[]) => openAnchorMock(...args),
      getSnapshot: (...args: unknown[]) => getAnchorSnapshotMock(...args),
    },
    turns: {
      getSessionSnapshot: (...args: unknown[]) => getSessionSnapshotMock(...args),
      subscribe: (...args: unknown[]) => subscribeTurnsMock(...args),
      request: (...args: unknown[]) => requestTurnMock(...args),
      interrupt: (...args: unknown[]) => interruptTurnMock(...args),
    },
  },
  media: {
    stt: {
      transcribe: (...args: unknown[]) => transcribeMock(...args),
    },
  },
  route: {
    listOptions: (...args: unknown[]) => listRouteOptionsMock(...args),
    checkHealth: (...args: unknown[]) => checkRouteHealthMock(...args),
  },
};

function launchContext(overrides: Partial<{
  agentId: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
}> = {}) {
  return {
    agentId: 'agent-launch',
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
    ...overrides,
  };
}

vi.mock('../driver/factory.js', () => ({
  resolveDriverKind: () => driverKind,
  createDriver: (...args: unknown[]) => createDriverMock(...args),
}));

vi.mock('@nimiplatform/sdk', () => ({
  AccountCallerMode: { LOCAL_FIRST_PARTY_APP: 1 },
  AccountSessionState: { AUTHENTICATED: 3 },
  createLocalFirstPartyRuntimePlatformClient: (...args: unknown[]) =>
    createLocalFirstPartyRuntimePlatformClientMock(...args),
}));

vi.mock('@nimiplatform/sdk/runtime/browser', () => ({
  AccountCallerMode: { LOCAL_FIRST_PARTY_APP: 1 },
}));

vi.mock('../mock/scenarios/default.mock.json?raw', () => ({
  default: JSON.stringify({ fixture: true }),
}));

vi.mock('../live2d/model-loader.js', () => ({
  resolveAgentCenterAvatarPackageManifest: (...args: unknown[]) =>
    resolveAgentCenterAvatarPackageManifestMock(...args),
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
}));

vi.mock('./tauri-lifecycle.js', () => ({
  isTauriRuntime: () => true,
  onShellReady: (...args: unknown[]) => onShellReadyMock(...args),
}));

vi.mock('./tauri-commands.js', () => ({
  setAlwaysOnTop: (...args: unknown[]) => setAlwaysOnTopMock(...args),
}));

vi.mock('./avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) => recordAvatarEvidenceEventuallyMock(...args),
}));

function createFakeDriver(kind: 'sdk' | 'mock'): AgentDataDriver {
  let statusHandler: ((status: DriverStatus) => void) | null = null;
  let bundleHandler: ((bundle: AgentDataBundle) => void) | null = null;
  return {
    kind,
    status: 'idle',
    async start() {
      statusHandler?.('running');
      bundleHandler?.({
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
          session_id: 'anchor-1',
          locale: 'en-US',
        },
      });
    },
    async stop() {
      driverStopMock();
      statusHandler?.('stopped');
    },
    getBundle() {
      throw new Error('not needed in bootstrap test');
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
    createDriverMock.mockReset();
    getAvatarLaunchContextMock.mockReset();
    getRuntimeDefaultsMock.mockReset();
    getDaemonStatusMock.mockReset();
    startDaemonMock.mockReset();
    hasTauriInvokeMock.mockReset();
    onShellReadyMock.mockReset();
    setAlwaysOnTopMock.mockReset();
    driverStopMock.mockReset();
    createLocalFirstPartyRuntimePlatformClientMock.mockReset();
    getAccountSessionStatusMock.mockReset();
    getAccessTokenMock.mockReset();
    openAnchorMock.mockReset();
    getAnchorSnapshotMock.mockReset();
    getSessionSnapshotMock.mockReset();
    subscribeTurnsMock.mockReset();
    requestTurnMock.mockReset();
    interruptTurnMock.mockReset();
    transcribeMock.mockReset();
    listRouteOptionsMock.mockReset();
    checkRouteHealthMock.mockReset();
    resolveAgentCenterAvatarPackageManifestMock.mockReset();
    startAvatarRuntimeCarrierMock.mockReset();
    carrierShutdownMock.mockReset();
    recordAvatarEvidenceEventuallyMock.mockReset();
    window.localStorage.clear();
    createDriverMock.mockImplementation((input: { kind: 'sdk' | 'mock' }) => createFakeDriver(input.kind));
    onShellReadyMock.mockResolvedValue(() => {});
    setAlwaysOnTopMock.mockResolvedValue(undefined);
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
        revocationUrl: 'http://localhost:3002/api/auth/revocation',
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
    createLocalFirstPartyRuntimePlatformClientMock.mockResolvedValue({ runtime: runtimeMock });
    getAccountSessionStatusMock.mockResolvedValue({
      state: 3,
      accountProjection: { accountId: 'account-runtime' },
    });
    getAccessTokenMock.mockResolvedValue({
      accepted: true,
      accessToken: 'runtime-issued-short-lived-token',
    });
    openAnchorMock.mockResolvedValue({
      anchor: {
        conversationAnchorId: 'anchor-runtime',
        agentId: 'agent-launch',
        subjectUserId: 'account-runtime',
      },
    });
    getAnchorSnapshotMock.mockRejectedValue(new Error('no persisted anchor'));
    getSessionSnapshotMock.mockResolvedValue({
      sessionStatus: 'ready',
      transcriptMessageCount: 0,
      executionBinding: {
        route: 'local',
        modelId: 'local-model',
      },
    });
    subscribeTurnsMock.mockResolvedValue((async function* emptyStream() {})());
    resolveAgentCenterAvatarPackageManifestMock.mockResolvedValue({
      runtimeDir: '/models/ren/files',
      modelId: 'ren',
      model3JsonPath: '/models/ren/files/ren.model3.json',
      nimiDir: null,
      adapterManifestPath: null,
    });
    startAvatarRuntimeCarrierMock.mockResolvedValue({
      shutdown: carrierShutdownMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bootstraps default Avatar as a local first-party Runtime app from minimal launch intent', async () => {
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAvatarLaunchContextMock).toHaveBeenCalledTimes(1);
    expect(getDaemonStatusMock).toHaveBeenCalledTimes(1);
    expect(startDaemonMock).not.toHaveBeenCalled();
    expect(createLocalFirstPartyRuntimePlatformClientMock).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'nimi.avatar',
      realmBaseUrl: 'http://localhost:3002',
    }));
    expect(createLocalFirstPartyRuntimePlatformClientMock.mock.calls[0]?.[0]).not.toHaveProperty('accessToken');
    expect(createLocalFirstPartyRuntimePlatformClientMock.mock.calls[0]?.[0]).not.toHaveProperty('refreshTokenProvider');
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
    expect(openAnchorMock).toHaveBeenCalledWith({
      agentId: 'agent-launch',
      metadata: {
        launch_source: 'desktop-agent-chat',
        avatar_instance_id: 'instance-1',
        surface: 'avatar-first-party',
      },
    });
    expect(resolveAgentCenterAvatarPackageManifestMock).toHaveBeenCalledWith({
      accountId: 'account-runtime',
      agentId: 'agent-launch',
    });
    expect(useAvatarStore.getState().launch.context).toEqual({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
    expect(useAvatarStore.getState().consume.authority).toBe('runtime');
    expect(useAvatarStore.getState().runtime.binding.status).toBe('active');
    expect(useAvatarStore.getState().runtime.binding.projection).toBeNull();
    expect(useAvatarStore.getState().consume).toEqual(expect.objectContaining({
      avatarInstanceId: 'instance-1',
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-runtime',
      worldId: '',
    }));
    expect(createDriverMock).toHaveBeenCalledWith({
      kind: 'sdk',
      sdk: expect.objectContaining({
        runtime: runtimeMock,
        agentId: 'agent-launch',
        conversationAnchorId: 'anchor-runtime',
        activeWorldId: '',
        activeUserId: 'account-runtime',
      }),
    });
    expect(startAvatarRuntimeCarrierMock).toHaveBeenCalledWith({
      driver: handle.driver,
      modelManifest: expect.objectContaining({ modelId: 'ren' }),
    });
    expect(handle.driver).not.toBeNull();
    expect(handle.carrier).not.toBeNull();

    await handle.shutdown();
    expect(carrierShutdownMock).toHaveBeenCalledTimes(1);
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
    expect(createLocalFirstPartyRuntimePlatformClientMock).toHaveBeenCalledTimes(1);
    expect(openAnchorMock).toHaveBeenCalledTimes(1);
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
    expect(createLocalFirstPartyRuntimePlatformClientMock).not.toHaveBeenCalled();
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

  it('does not require Desktop package anchor or scoped binding launch fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T00:00:00.000Z'));
    getAvatarLaunchContextMock.mockResolvedValue(launchContext({
      avatarInstanceId: null,
      launchSource: null,
    }));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(useAvatarStore.getState().launch.context).toEqual({
      agentId: 'agent-launch',
      avatarInstanceId: null,
      launchSource: null,
    });
    expect(useAvatarStore.getState().runtime.binding.status).toBe('active');
    expect(openAnchorMock).toHaveBeenCalledWith({
      agentId: 'agent-launch',
      metadata: {
        launch_source: null,
        avatar_instance_id: 'avatar-1777420800000',
        surface: 'avatar-first-party',
      },
    });
    expect(useAvatarStore.getState().consume.avatarInstanceId).toBe('avatar-1777420800000');
    expect(createDriverMock).toHaveBeenCalledTimes(1);
    expect(createDriverMock.mock.calls[0]?.[0]?.sdk).not.toHaveProperty('scopedBinding');

    await handle.shutdown();
  });

  it('recovers the Avatar-owned conversation anchor for the same account agent and instance', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v1', JSON.stringify({
      schemaVersion: 1,
      records: [{
        schemaVersion: 1,
        accountId: 'account-runtime',
        agentId: 'agent-launch',
        avatarInstanceId: 'instance-1',
        conversationAnchorId: 'anchor-recovered',
        updatedAtMs: 1777420800000,
      }],
    }));
    getAnchorSnapshotMock.mockResolvedValue({
      anchor: {
        conversationAnchorId: 'anchor-recovered',
        agentId: 'agent-launch',
        subjectUserId: 'account-runtime',
      },
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).toHaveBeenCalledWith({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-recovered',
    });
    expect(openAnchorMock).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-recovered');
    expect(createDriverMock).toHaveBeenCalledWith({
      kind: 'sdk',
      sdk: expect.objectContaining({
        conversationAnchorId: 'anchor-recovered',
        activeUserId: 'account-runtime',
      }),
    });

    await handle.shutdown();
  });

  it('does not reuse a persisted anchor across a different Avatar instance', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v1', JSON.stringify({
      schemaVersion: 1,
      records: [{
        schemaVersion: 1,
        accountId: 'account-runtime',
        agentId: 'agent-launch',
        avatarInstanceId: 'instance-other',
        conversationAnchorId: 'anchor-other',
        updatedAtMs: 1777420800000,
      }],
    }));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).not.toHaveBeenCalled();
    expect(openAnchorMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-runtime');

    await handle.shutdown();
  });

  it('does not recover a persisted anchor when Runtime snapshot belongs to a different account', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v1', JSON.stringify({
      schemaVersion: 1,
      records: [{
        schemaVersion: 1,
        accountId: 'account-runtime',
        agentId: 'agent-launch',
        avatarInstanceId: 'instance-1',
        conversationAnchorId: 'anchor-stale',
        updatedAtMs: 1777420800000,
      }],
    }));
    getAnchorSnapshotMock.mockResolvedValue({
      anchor: {
        conversationAnchorId: 'anchor-stale',
        agentId: 'agent-launch',
        subjectUserId: 'other-account',
      },
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).toHaveBeenCalledWith({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-stale',
    });
    expect(openAnchorMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-runtime');
    expect(window.localStorage.getItem('nimi.avatar.conversation-context.v1')).toContain('anchor-runtime');
    expect(window.localStorage.getItem('nimi.avatar.conversation-context.v1')).not.toContain('anchor-stale');

    await handle.shutdown();
  });

  it('keeps same-agent Avatar instances isolated by avatarInstanceId', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v1', JSON.stringify({
      schemaVersion: 1,
      records: [
        {
          schemaVersion: 1,
          accountId: 'account-runtime',
          agentId: 'agent-launch',
          avatarInstanceId: 'instance-1',
          conversationAnchorId: 'anchor-instance-1',
          updatedAtMs: 1777420800000,
        },
        {
          schemaVersion: 1,
          accountId: 'account-runtime',
          agentId: 'agent-launch',
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
        agentId: 'agent-launch',
        subjectUserId: 'account-runtime',
      },
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).toHaveBeenCalledWith({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-instance-2',
    });
    expect(useAvatarStore.getState().consume.avatarInstanceId).toBe('instance-2');
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBe('anchor-instance-2');
    expect(openAnchorMock).not.toHaveBeenCalled();

    await handle.shutdown();
  });

  it('keeps different-agent Avatar instances isolated by agentId', async () => {
    window.localStorage.setItem('nimi.avatar.conversation-context.v1', JSON.stringify({
      schemaVersion: 1,
      records: [{
        schemaVersion: 1,
        accountId: 'account-runtime',
        agentId: 'agent-other',
        avatarInstanceId: 'instance-1',
        conversationAnchorId: 'anchor-other-agent',
        updatedAtMs: 1777420800000,
      }],
    }));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(getAnchorSnapshotMock).not.toHaveBeenCalled();
    expect(openAnchorMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().consume.agentId).toBe('agent-launch');
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

  it('surfaces first-party Runtime bootstrap stage when anchor authorization fails', async () => {
    openAnchorMock.mockRejectedValue(Object.assign(new Error('permission denied'), {
      reasonCode: 'PRINCIPAL_UNAUTHORIZED',
      actionHint: 'check_runtime_bridge_and_daemon',
      source: 'runtime',
      retryable: true,
    }));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    expect(useAvatarStore.getState().runtime.binding.reason).toBe(
      'conversation_anchor_open: PRINCIPAL_UNAUTHORIZED / check_runtime_bridge_and_daemon',
    );
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'avatar.runtime.bind-failed',
      detail: expect.objectContaining({
        reason: 'conversation_anchor_open: PRINCIPAL_UNAUTHORIZED / check_runtime_bridge_and_daemon',
        error_stage: 'conversation_anchor_open',
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

  it('keeps visual bootstrap available and degrades interaction when driver start hangs', async () => {
    vi.useFakeTimers();
    createDriverMock.mockReturnValue({
      ...createFakeDriver('sdk'),
      start: vi.fn(() => new Promise(() => {})),
    });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(handle.driver).not.toBeNull();
    expect(handle.carrier).not.toBeNull();
    expect(startAvatarRuntimeCarrierMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().runtime.binding.status).toBe('active');

    await vi.advanceTimersByTimeAsync(12_000);
    await Promise.resolve();

    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    expect(useAvatarStore.getState().runtime.binding.reason).toBe(
      'driver_start: driver_start timed out after 12000ms',
    );
    expect(startAvatarRuntimeCarrierMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().driver.status).toBe('error');

    await handle.shutdown();
  });

  it('uses mock fixture only when explicitly requested', async () => {
    driverKind = 'mock';
    createDriverMock.mockReturnValue(createFakeDriver('mock'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(createDriverMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'mock',
      scenarioSource: 'default.mock.json',
    }));
    expect(useAvatarStore.getState().consume.authority).toBe('fixture');

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
