import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────

const mockGetRuntimeDefaults = vi.fn();
const mockGetDaemonStatus = vi.fn();
const mockInitI18n = vi.fn();
const mockBootstrapAuthSession = vi.fn();
const mockInitializePlatformClient = vi.fn();

vi.mock('@renderer/bridge/runtime-defaults.js', () => ({
  getRuntimeDefaults: (...args: unknown[]) => mockGetRuntimeDefaults(...args),
}));

vi.mock('@renderer/bridge/runtime-daemon.js', () => ({
  getDaemonStatus: (...args: unknown[]) => mockGetDaemonStatus(...args),
}));

vi.mock('@renderer/i18n/index.js', () => ({
  initI18n: (...args: unknown[]) => mockInitI18n(...args),
}));

vi.mock('./forge-bootstrap-auth.js', () => ({
  bootstrapAuthSession: (...args: unknown[]) => mockBootstrapAuthSession(...args),
}));

vi.mock('@runtime/platform-client.js', () => ({
  initializePlatformClient: (...args: unknown[]) => mockInitializePlatformClient(...args),
}));

const { useAppStore } = await import('@renderer/app-shell/providers/app-store.js');

const { runForgeBootstrap } = await import('./forge-bootstrap.js');

// ── Helpers ────────────────────────────────────────────────

function makeRuntimeDefaults() {
  return {
    realm: {
      realmBaseUrl: 'http://localhost:3002',
      realtimeUrl: 'ws://localhost:3003',
      accessToken: 'test-token-abc',
      jwksUrl: 'http://localhost:3002/api/auth/jwks',
      jwtIssuer: 'http://localhost:3002',
      jwtAudience: 'nimi-runtime',
    },
    runtime: {
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'test-model',
      localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
      connectorId: '',
      targetType: 'AGENT',
      targetAccountId: '',
      agentId: '',
      worldId: '',
      provider: '',
      userConfirmedUpload: false,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('runForgeBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: '' },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
    });
  });

  it('completes the 7-step bootstrap sequence', async () => {
    const defaults = makeRuntimeDefaults();
    const mockRuntime = { ready: vi.fn().mockResolvedValue(undefined) };
    const mockRealm = { raw: { request: vi.fn() } };

    mockInitI18n.mockResolvedValue(undefined);
    mockGetRuntimeDefaults.mockResolvedValue(defaults);
    mockInitializePlatformClient.mockResolvedValue({ runtime: mockRuntime, realm: mockRealm });
    mockBootstrapAuthSession.mockResolvedValue(undefined);
    mockGetDaemonStatus.mockResolvedValue({ running: true, managed: true });

    await runForgeBootstrap();

    // Step 1: i18n initialized
    expect(mockInitI18n).toHaveBeenCalledOnce();

    // Step 2: Runtime defaults fetched and stored
    expect(mockGetRuntimeDefaults).toHaveBeenCalledOnce();
    expect(useAppStore.getState().runtimeDefaults).toEqual(defaults);

    // Step 3: Platform client initialized with correct params
    expect(mockInitializePlatformClient).toHaveBeenCalledWith(
      expect.objectContaining({
        realmBaseUrl: defaults.realm.realmBaseUrl,
        accessToken: defaults.realm.accessToken,
      }),
    );

    // Step 4: Auth session bootstrapped
    expect(mockBootstrapAuthSession).toHaveBeenCalledWith({
      realm: mockRealm,
      accessToken: defaults.realm.accessToken,
    });

    // Step 5: Runtime readiness checked
    expect(mockRuntime.ready).toHaveBeenCalledOnce();

    // Step 6: Daemon status checked
    expect(mockGetDaemonStatus).toHaveBeenCalledOnce();

    // Step 7: Bootstrap ready
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().bootstrapError).toBeNull();
  });

  it('sets bootstrapError on fatal failure', async () => {
    mockInitI18n.mockRejectedValue(new Error('i18n failed'));

    await runForgeBootstrap();

    expect(useAppStore.getState().bootstrapReady).toBe(false);
    expect(useAppStore.getState().bootstrapError).toBe('i18n failed');
  });

  it('continues if runtime.ready() fails (non-blocking)', async () => {
    const defaults = makeRuntimeDefaults();
    const mockRuntime = { ready: vi.fn().mockRejectedValue(new Error('no runtime')) };
    const mockRealm = { raw: { request: vi.fn() } };

    mockInitI18n.mockResolvedValue(undefined);
    mockGetRuntimeDefaults.mockResolvedValue(defaults);
    mockInitializePlatformClient.mockResolvedValue({ runtime: mockRuntime, realm: mockRealm });
    mockBootstrapAuthSession.mockResolvedValue(undefined);
    mockGetDaemonStatus.mockResolvedValue({ running: false, managed: false });

    await runForgeBootstrap();

    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().bootstrapError).toBeNull();
  });

  it('continues if getDaemonStatus fails (non-blocking)', async () => {
    const defaults = makeRuntimeDefaults();
    const mockRuntime = { ready: vi.fn().mockResolvedValue(undefined) };
    const mockRealm = { raw: { request: vi.fn() } };

    mockInitI18n.mockResolvedValue(undefined);
    mockGetRuntimeDefaults.mockResolvedValue(defaults);
    mockInitializePlatformClient.mockResolvedValue({ runtime: mockRuntime, realm: mockRealm });
    mockBootstrapAuthSession.mockResolvedValue(undefined);
    mockGetDaemonStatus.mockRejectedValue(new Error('daemon not available'));

    await runForgeBootstrap();

    expect(useAppStore.getState().bootstrapReady).toBe(true);
  });

  it('sets bootstrapError when getRuntimeDefaults fails', async () => {
    mockInitI18n.mockResolvedValue(undefined);
    mockGetRuntimeDefaults.mockRejectedValue(new Error('bridge unavailable'));

    await runForgeBootstrap();

    expect(useAppStore.getState().bootstrapReady).toBe(false);
    expect(useAppStore.getState().bootstrapError).toBe('bridge unavailable');
  });

  it('accessTokenProvider reads latest token from store', async () => {
    const defaults = makeRuntimeDefaults();
    const mockRuntime = { ready: vi.fn().mockResolvedValue(undefined) };
    const mockRealm = { raw: { request: vi.fn() } };
    let capturedProvider: (() => string) | undefined;

    mockInitI18n.mockResolvedValue(undefined);
    mockGetRuntimeDefaults.mockResolvedValue(defaults);
    mockInitializePlatformClient.mockImplementation((input: Record<string, unknown>) => {
      capturedProvider = input.accessTokenProvider as () => string;
      return Promise.resolve({ runtime: mockRuntime, realm: mockRealm });
    });
    mockBootstrapAuthSession.mockResolvedValue(undefined);
    mockGetDaemonStatus.mockResolvedValue({ running: false, managed: false });

    await runForgeBootstrap();

    // Initially returns store token (empty)
    expect(capturedProvider?.()).toBe('');

    // After setting auth session, returns updated token
    useAppStore.getState().setAuthSession(
      { id: 'u1', displayName: 'Test' },
      'new-token-xyz',
      'refresh-token',
    );
    expect(capturedProvider?.()).toBe('new-token-xyz');
  });
});
