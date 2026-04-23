import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, DriverStatus } from '../driver/types.js';
import { useAvatarStore } from './app-store.js';

let driverKind: 'sdk' | 'mock' = 'sdk';
const createDriverMock = vi.fn();
const createPlatformClientMock = vi.fn();
const clearPlatformClientMock = vi.fn();
const resolveDesktopBootstrapAuthSessionMock = vi.fn();
const bootstrapAuthSessionMock = vi.fn();
const getAvatarLaunchContextMock = vi.fn();
const getRuntimeDefaultsMock = vi.fn();
const hasTauriInvokeMock = vi.fn();
const loadAuthSessionMock = vi.fn();
const saveAuthSessionMock = vi.fn();
const clearAuthSessionMock = vi.fn();
const watchAuthSessionChangesMock = vi.fn();
const startDaemonMock = vi.fn();
const onShellReadyMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const openConversationAnchorMock = vi.fn();
const requestTurnMock = vi.fn();
const interruptTurnMock = vi.fn();
const routeListOptionsMock = vi.fn();
const routeCheckHealthMock = vi.fn();
const sttTranscribeMock = vi.fn();
const driverStopMock = vi.fn();
let watchedAuthSessionChange:
  | ((session: {
    realmBaseUrl: string;
    accessToken: string;
    refreshToken?: string;
    updatedAt: string;
    expiresAt?: string;
    user: {
      id: string;
      displayName: string;
      email?: string;
      avatarUrl?: string;
    } | null;
  } | null) => Promise<void> | void)
  | null = null;
let watchedAuthSessionError: ((error: Error) => Promise<void> | void) | null = null;

vi.mock('../driver/factory.js', () => ({
  resolveDriverKind: () => driverKind,
  createDriver: (...args: unknown[]) => createDriverMock(...args),
}));

vi.mock('@nimiplatform/sdk', () => ({
  createPlatformClient: (...args: unknown[]) => createPlatformClientMock(...args),
  clearPlatformClient: (...args: unknown[]) => clearPlatformClientMock(...args),
}));

vi.mock('@nimiplatform/nimi-kit/auth', () => ({
  resolveDesktopBootstrapAuthSession: (...args: unknown[]) => resolveDesktopBootstrapAuthSessionMock(...args),
  persistSharedDesktopAuthSession: vi.fn(),
}));

vi.mock('@renderer/bridge', () => ({
  getAvatarLaunchContext: (...args: unknown[]) => getAvatarLaunchContextMock(...args),
  getRuntimeDefaults: (...args: unknown[]) => getRuntimeDefaultsMock(...args),
  hasTauriInvoke: (...args: unknown[]) => hasTauriInvokeMock(...args),
  loadAuthSession: (...args: unknown[]) => loadAuthSessionMock(...args),
  saveAuthSession: (...args: unknown[]) => saveAuthSessionMock(...args),
  clearAuthSession: (...args: unknown[]) => clearAuthSessionMock(...args),
  watchAuthSessionChanges: (...args: unknown[]) => watchAuthSessionChangesMock(...args),
  startDaemon: (...args: unknown[]) => startDaemonMock(...args),
}));

vi.mock('./bootstrap-auth.js', () => ({
  bootstrapAuthSession: (...args: unknown[]) => bootstrapAuthSessionMock(...args),
}));

vi.mock('./tauri-lifecycle.js', () => ({
  isTauriRuntime: () => true,
  onShellReady: (...args: unknown[]) => onShellReadyMock(...args),
}));

vi.mock('./tauri-commands.js', () => ({
  setAlwaysOnTop: (...args: unknown[]) => setAlwaysOnTopMock(...args),
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
    createPlatformClientMock.mockReset();
    resolveDesktopBootstrapAuthSessionMock.mockReset();
    clearPlatformClientMock.mockReset();
    bootstrapAuthSessionMock.mockReset();
    getAvatarLaunchContextMock.mockReset();
    getRuntimeDefaultsMock.mockReset();
    hasTauriInvokeMock.mockReset();
    loadAuthSessionMock.mockReset();
    saveAuthSessionMock.mockReset();
    clearAuthSessionMock.mockReset();
    watchAuthSessionChangesMock.mockReset();
    startDaemonMock.mockReset();
    onShellReadyMock.mockReset();
    setAlwaysOnTopMock.mockReset();
    openConversationAnchorMock.mockReset();
    requestTurnMock.mockReset();
    interruptTurnMock.mockReset();
    routeListOptionsMock.mockReset();
    routeCheckHealthMock.mockReset();
    sttTranscribeMock.mockReset();
    driverStopMock.mockReset();
    watchedAuthSessionChange = null;
    watchedAuthSessionError = null;
    window.localStorage.clear();
    onShellReadyMock.mockResolvedValue(() => {});
    setAlwaysOnTopMock.mockResolvedValue(undefined);
    watchAuthSessionChangesMock.mockImplementation((input: {
      onChange: typeof watchedAuthSessionChange;
      onError?: typeof watchedAuthSessionError;
    }) => {
      watchedAuthSessionChange = input.onChange ?? null;
      watchedAuthSessionError = input.onError ?? null;
      return () => {
        watchedAuthSessionChange = null;
        watchedAuthSessionError = null;
      };
    });
    hasTauriInvokeMock.mockReturnValue(true);
    getAvatarLaunchContextMock.mockResolvedValue({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-1',
      conversationAnchorId: 'anchor-launch',
      anchorMode: 'existing',
      launchedBy: 'desktop',
      sourceSurface: 'desktop-agent-chat',
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
    resolveDesktopBootstrapAuthSessionMock.mockResolvedValue({
      source: 'persisted',
      resolution: 'persisted-session',
      session: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
      shouldClearPersistedSession: false,
    });
    bootstrapAuthSessionMock.mockImplementation(async () => {
      useAvatarStore.getState().setAuthSession(
        {
          id: 'user-1',
          displayName: 'Avatar User',
        },
        'access-token',
        'refresh-token',
      );
      return {
        id: 'user-1',
        displayName: 'Avatar User',
      };
    });
    startDaemonMock.mockResolvedValue({ running: true });
    createPlatformClientMock.mockResolvedValue({
      runtime: {
        ready: async () => undefined,
        route: {
          listOptions: (...args: unknown[]) => routeListOptionsMock(...args),
          checkHealth: (...args: unknown[]) => routeCheckHealthMock(...args),
        },
        media: {
          stt: {
            transcribe: (...args: unknown[]) => sttTranscribeMock(...args),
          },
        },
        agent: {
          anchors: {
            open: (...args: unknown[]) => openConversationAnchorMock(...args),
          },
          turns: {
            request: (...args: unknown[]) => requestTurnMock(...args),
            interrupt: (...args: unknown[]) => interruptTurnMock(...args),
          },
        },
      },
      realm: {},
    });
    openConversationAnchorMock.mockResolvedValue({ conversationAnchorId: 'anchor-opened' });
    routeListOptionsMock.mockResolvedValue({
      capability: 'audio.transcribe',
      selected: {
        source: 'cloud',
        connectorId: 'connector-stt',
        model: 'stt-model',
        modelId: 'stt-model',
      },
      resolvedDefault: null,
      local: {
        models: [],
      },
      connectors: [],
    });
    routeCheckHealthMock.mockResolvedValue({
      healthy: true,
      status: 'healthy',
      provider: 'speech',
      actionHint: 'none',
      reasonCode: 'RUNTIME_ROUTE_HEALTHY',
    });
    sttTranscribeMock.mockResolvedValue({
      text: 'spoken anchor note',
      artifacts: [],
      trace: {},
      job: {} as never,
    });
  });

  it('boots through sdk as the normal path and does not require mock fixture input', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(createDriverMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'sdk',
      sdk: expect.objectContaining({
        agentId: 'agent-launch',
        conversationAnchorId: 'anchor-launch',
        activeWorldId: 'world-1',
        activeUserId: 'user-1',
      }),
    }));
    expect(createDriverMock.mock.calls[0]?.[0]).not.toHaveProperty('scenarioJson');
    expect(createDriverMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sdk: expect.objectContaining({
        agentId: 'agent-launch',
        conversationAnchorId: 'anchor-launch',
      }),
    }));
    expect(createDriverMock.mock.calls[0]?.[0]).not.toEqual(expect.objectContaining({
      sdk: expect.objectContaining({
        agentId: 'runtime-default-agent',
      }),
    }));
    expect(openConversationAnchorMock).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().consume.authority).toBe('runtime');
    expect(useAvatarStore.getState().consume.avatarInstanceId).toBe('instance-1');

    await handle.shutdown();
  });

  it('hydrates the persisted always-on-top preference before shell bootstrap applies window posture', async () => {
    window.localStorage.setItem('nimi.avatar.shell-settings.v1', JSON.stringify({
      schemaVersion: 1,
      alwaysOnTop: false,
    }));
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(setAlwaysOnTopMock).toHaveBeenCalledWith(false);
    expect(useAvatarStore.getState().shell.alwaysOnTop).toBe(false);

    await handle.shutdown();
  });

  it('opens a new anchor only when launch context explicitly requires it', async () => {
    getAvatarLaunchContextMock.mockResolvedValue({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-new-anchor',
      conversationAnchorId: null,
      anchorMode: 'open_new',
      launchedBy: 'desktop',
      sourceSurface: 'desktop-agent-chat',
    });
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(createDriverMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'sdk',
      sdk: expect.objectContaining({
        agentId: 'agent-launch',
        conversationAnchorId: 'anchor-opened',
      }),
    }));
    expect(openConversationAnchorMock).toHaveBeenCalledWith({
      agentId: 'agent-launch',
      metadata: expect.objectContaining({
        avatarInstanceId: 'instance-new-anchor',
        launchedBy: 'desktop',
      }),
    });

    await handle.shutdown();
  });

  it('keeps same-agent launches bound to distinct anchors across desktop-selected contexts', async () => {
    createDriverMock.mockImplementation(() => createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    getAvatarLaunchContextMock.mockResolvedValueOnce({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-anchor-a',
      conversationAnchorId: 'anchor-a',
      anchorMode: 'existing',
      launchedBy: 'desktop',
      sourceSurface: 'desktop-agent-chat',
    });
    const firstHandle = await bootstrapAvatar();
    const firstSdkConfig = createDriverMock.mock.calls[0]?.[0]?.sdk;
    await firstHandle.shutdown();

    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    getAvatarLaunchContextMock.mockResolvedValueOnce({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-anchor-b',
      conversationAnchorId: 'anchor-b',
      anchorMode: 'existing',
      launchedBy: 'desktop',
      sourceSurface: 'desktop-agent-chat',
    });
    const secondHandle = await bootstrapAvatar();
    const secondSdkConfig = createDriverMock.mock.calls[1]?.[0]?.sdk;

    expect(firstSdkConfig).toEqual(expect.objectContaining({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-a',
    }));
    expect(secondSdkConfig).toEqual(expect.objectContaining({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-b',
    }));
    expect(firstSdkConfig?.conversationAnchorId).not.toBe(secondSdkConfig?.conversationAnchorId);
    expect(openConversationAnchorMock).not.toHaveBeenCalled();

    await secondHandle.shutdown();
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
    getAvatarLaunchContextMock.mockRejectedValue(
      new Error('avatar launch context is required; launch from desktop orchestrator'),
    );
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    await expect(bootstrapAvatar()).rejects.toThrow(
      'avatar launch context is required; launch from desktop orchestrator',
    );
  });

  it('fails closed when runtime daemon cannot start instead of falling back to mock', async () => {
    startDaemonMock.mockResolvedValue({ running: false, lastError: 'daemon failed hard' });
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    await expect(bootstrapAvatar()).rejects.toThrow(/daemon failed hard/);
    expect(createDriverMock).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'mock' }));
    expect(clearPlatformClientMock).toHaveBeenCalledTimes(1);
  });

  it('updates local auth state when the shared session rotates for the same user', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();
    expect(watchAuthSessionChangesMock).toHaveBeenCalledTimes(1);

    await watchedAuthSessionChange?.({
      realmBaseUrl: 'http://localhost:3002',
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      updatedAt: '2026-04-22T08:00:00.000Z',
      expiresAt: '2026-04-22T09:00:00.000Z',
      user: {
        id: 'user-1',
        displayName: 'Avatar User Updated',
        email: 'avatar@example.com',
      },
    });

    expect(useAvatarStore.getState().auth).toEqual(expect.objectContaining({
      status: 'authenticated',
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      failureReason: null,
      user: expect.objectContaining({
        id: 'user-1',
        displayName: 'Avatar User Updated',
        email: 'avatar@example.com',
      }),
    }));
    expect(driverStopMock).not.toHaveBeenCalled();
    expect(clearPlatformClientMock).not.toHaveBeenCalled();

    await handle.shutdown();
  });

  it('fails closed when the shared desktop session disappears after bootstrap', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();
    await watchedAuthSessionChange?.(null);

    expect(driverStopMock).toHaveBeenCalledTimes(1);
    expect(clearPlatformClientMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().auth).toEqual(expect.objectContaining({
      status: 'anonymous',
      failureReason: 'shared_session_missing',
    }));
    expect(useAvatarStore.getState().bundle).toBeNull();
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBeNull();
    expect(useAvatarStore.getState().driver.status).toBe('stopped');

    await handle.shutdown();
  });

  it('fails closed immediately when sdk refresh failure clears the auth session', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();
    const sessionStore = createPlatformClientMock.mock.calls[0]?.[0]?.sessionStore;

    await sessionStore?.clearAuthSession?.();

    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(driverStopMock).toHaveBeenCalledTimes(1);
    expect(clearPlatformClientMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().auth).toEqual(expect.objectContaining({
      status: 'anonymous',
      failureReason: 'shared_session_invalid',
    }));
    expect(useAvatarStore.getState().bundle).toBeNull();
    expect(useAvatarStore.getState().consume.conversationAnchorId).toBeNull();
    expect(useAvatarStore.getState().driver.status).toBe('stopped');

    await handle.shutdown();
  });

  it('submits Wave 2 text turns only to the current explicit agent and anchor binding', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    requestTurnMock.mockResolvedValue({ accepted: true });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();
    useAvatarStore.getState().setBundle({
      ...useAvatarStore.getState().bundle!,
      custom: {
        execution_binding: {
          route: 'cloud',
          modelId: 'gpt-5.4-mini',
          connectorId: 'connector-text',
        },
      },
    });

    await handle.requestTextTurn({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-launch',
      text: 'hello from avatar',
    });

    expect(requestTurnMock).toHaveBeenCalledWith({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-launch',
      worldId: 'world-1',
      messages: [{ role: 'user', content: 'hello from avatar' }],
      executionBinding: {
        route: 'cloud',
        modelId: 'gpt-5.4-mini',
        connectorId: 'connector-text',
      },
    });

    await handle.shutdown();
  });

  it('rejects Wave 2 text turns when same-agent traffic points at a different anchor', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();
    await expect(handle.requestTextTurn({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-other',
      text: 'wrong anchor',
    })).rejects.toThrow('avatar companion input requires the current explicit agent and anchor binding');
    expect(requestTurnMock).not.toHaveBeenCalled();

    await handle.shutdown();
  });

  it('submits Wave 3 voice captures only through the current explicit agent and anchor binding', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    requestTurnMock.mockResolvedValue({ accepted: true });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();
    useAvatarStore.getState().setBundle({
      ...useAvatarStore.getState().bundle!,
      custom: {
        execution_binding: {
          route: 'cloud',
          modelId: 'gpt-5.4-mini',
          connectorId: 'connector-text',
        },
      },
    });

    const result = await handle.submitVoiceCaptureTurn({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-launch',
      audioBytes: new Uint8Array([9, 8, 7]),
      mimeType: 'audio/webm',
      language: 'en-US',
    });

    expect(routeListOptionsMock).toHaveBeenCalledWith({
      capability: 'audio.transcribe',
    });
    expect(routeCheckHealthMock).toHaveBeenCalledWith({
      capability: 'audio.transcribe',
      binding: expect.objectContaining({
        modelId: 'stt-model',
        connectorId: 'connector-stt',
      }),
    });
    expect(sttTranscribeMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'stt-model',
      route: 'cloud',
      connectorId: 'connector-stt',
      mimeType: 'audio/webm',
      language: 'en-US',
    }));
    expect(requestTurnMock).toHaveBeenCalledWith({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-launch',
      worldId: 'world-1',
      messages: [{ role: 'user', content: 'spoken anchor note' }],
      executionBinding: {
        route: 'cloud',
        modelId: 'gpt-5.4-mini',
        connectorId: 'connector-text',
      },
    });
    expect(result).toEqual({
      transcript: 'spoken anchor note',
    });

    await handle.shutdown();
  });

  it('rejects Wave 3 voice captures when same-agent traffic points at a different anchor', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    await expect(handle.submitVoiceCaptureTurn({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-other',
      audioBytes: new Uint8Array([1]),
      mimeType: 'audio/webm',
    })).rejects.toThrow('Foreground voice requires the current explicit agent and anchor binding');
    expect(sttTranscribeMock).not.toHaveBeenCalled();
    expect(requestTurnMock).not.toHaveBeenCalled();

    await handle.shutdown();
  });

  it('does not submit a reply turn when the voice request is aborted after transcription resolves', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    requestTurnMock.mockResolvedValue({ accepted: true });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();
    useAvatarStore.getState().setBundle({
      ...useAvatarStore.getState().bundle!,
      custom: {
        execution_binding: {
          route: 'cloud',
          modelId: 'gpt-5.4-mini',
          connectorId: 'connector-text',
        },
      },
    });

    const controller = new AbortController();
    sttTranscribeMock.mockImplementationOnce(async () => {
      controller.abort();
      return {
        text: 'spoken anchor note',
        artifacts: [],
        trace: {},
        job: {} as never,
      };
    });

    await expect(handle.submitVoiceCaptureTurn({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-launch',
      audioBytes: new Uint8Array([9, 8, 7]),
      mimeType: 'audio/webm',
      signal: controller.signal,
    })).rejects.toThrow('Foreground voice request aborted before reply submission.');
    expect(requestTurnMock).not.toHaveBeenCalled();

    await handle.shutdown();
  });

  it('does not submit a reply turn when the current explicit anchor binding changes before request', async () => {
    createDriverMock.mockReturnValue(createFakeDriver('sdk'));
    requestTurnMock.mockResolvedValue({ accepted: true });
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();
    useAvatarStore.getState().setBundle({
      ...useAvatarStore.getState().bundle!,
      custom: {
        execution_binding: {
          route: 'cloud',
          modelId: 'gpt-5.4-mini',
          connectorId: 'connector-text',
        },
      },
    });

    sttTranscribeMock.mockImplementationOnce(async () => {
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: 'instance-2',
        conversationAnchorId: 'anchor-rebound',
        agentId: 'agent-launch',
        worldId: 'world-1',
      });
      return {
        text: 'spoken anchor note',
        artifacts: [],
        trace: {},
        job: {} as never,
      };
    });

    await expect(handle.submitVoiceCaptureTurn({
      agentId: 'agent-launch',
      conversationAnchorId: 'anchor-launch',
      audioBytes: new Uint8Array([9, 8, 7]),
      mimeType: 'audio/webm',
    })).rejects.toThrow('Foreground voice requires the current explicit agent and anchor binding');
    expect(requestTurnMock).not.toHaveBeenCalled();

    await handle.shutdown();
  });
});
