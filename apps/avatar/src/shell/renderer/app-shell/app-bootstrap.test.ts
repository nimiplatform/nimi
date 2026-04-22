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
const startDaemonMock = vi.fn();
const onShellReadyMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();

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
    async stop() {},
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
    startDaemonMock.mockReset();
    onShellReadyMock.mockReset();
    setAlwaysOnTopMock.mockReset();
    onShellReadyMock.mockResolvedValue(() => {});
    setAlwaysOnTopMock.mockResolvedValue(undefined);
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
    bootstrapAuthSessionMock.mockResolvedValue({
      id: 'user-1',
      displayName: 'Avatar User',
    });
    startDaemonMock.mockResolvedValue({ running: true });
    createPlatformClientMock.mockResolvedValue({
      runtime: {
        ready: async () => undefined,
        agent: {
          anchors: {
            open: async () => ({ conversationAnchorId: 'anchor-opened' }),
          },
        },
      },
      realm: {},
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
    expect(useAvatarStore.getState().consume.authority).toBe('runtime');
    expect(useAvatarStore.getState().consume.avatarInstanceId).toBe('instance-1');

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
});
