import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRuntimeDefaultsMock = vi.fn();
const resolveDesktopBootstrapAuthSessionMock = vi.fn();
const createPlatformClientMock = vi.fn();
const bootstrapParentOSAuthSessionMock = vi.fn();
const dbInitMock = vi.fn();
const getFamilyMock = vi.fn();
const getChildrenMock = vi.fn();
const loadPersistedParentosAIConfigMock = vi.fn();

vi.mock('../bridge/parentos-runtime-defaults.js', () => ({
  getParentOSRuntimeDefaults: getRuntimeDefaultsMock,
}));

vi.mock('@nimiplatform/nimi-kit/shell/renderer/bridge', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    clearAuthSession: vi.fn(),
    loadAuthSession: vi.fn(),
    saveAuthSession: vi.fn(),
  };
});

vi.mock('@nimiplatform/sdk', () => ({
  createPlatformClient: createPlatformClientMock,
}));

vi.mock('@nimiplatform/nimi-kit/auth', () => ({
  persistSharedDesktopAuthSession: vi.fn(),
  resolveDesktopBootstrapAuthSession: resolveDesktopBootstrapAuthSessionMock,
}));

vi.mock('../bridge/sqlite-bridge.js', () => ({
  dbInit: dbInitMock,
  getFamily: getFamilyMock,
  getChildren: getChildrenMock,
}));

vi.mock('../bridge/mappers.js', () => ({
  mapChildRow: vi.fn(),
}));

vi.mock('./parentos-bootstrap-auth.js', () => ({
  bootstrapParentOSAuthSession: bootstrapParentOSAuthSessionMock,
}));

vi.mock('../features/settings/parentos-ai-config.js', () => ({
  loadPersistedParentosAIConfig: loadPersistedParentosAIConfigMock,
}));

const { useAppStore } = await import('../app-shell/app-store.js');
const { runParentOSBootstrap } = await import('./parentos-bootstrap.js');

describe('parentos-bootstrap', () => {
  beforeEach(() => {
    getRuntimeDefaultsMock.mockReset();
    resolveDesktopBootstrapAuthSessionMock.mockReset();
    createPlatformClientMock.mockReset();
    bootstrapParentOSAuthSessionMock.mockReset();
    dbInitMock.mockReset();
    getFamilyMock.mockReset();
    getChildrenMock.mockReset();
    loadPersistedParentosAIConfigMock.mockReset();

    useAppStore.setState({
      auth: {
        status: 'bootstrapping',
        user: null,
        token: '',
        refreshToken: '',
      },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
      familyId: null,
      children: [],
      activeChildId: null,
      aiConfig: null,
    });

    getRuntimeDefaultsMock.mockResolvedValue({
      webBaseUrl: '',
      realm: {
        realmBaseUrl: 'http://localhost:3002',
        realtimeUrl: '',
        accessToken: '',
        jwksUrl: 'http://localhost:3002/api/auth/jwks',
        jwtIssuer: 'http://localhost:3002',
        jwtAudience: 'nimi-runtime',
      },
      runtime: {
        localProviderEndpoint: 'http://127.0.0.1:1234/v1',
        localProviderModel: 'local-model',
        localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
        connectorId: '',
        targetType: '',
        targetAccountId: '',
        agentId: '',
        worldId: '',
        provider: '',
        userConfirmedUpload: false,
      },
    });
    resolveDesktopBootstrapAuthSessionMock.mockResolvedValue({
      session: null,
      shouldClearPersistedSession: false,
      source: 'none',
    });
    createPlatformClientMock.mockResolvedValue({
      runtime: {
        ready: vi.fn().mockRejectedValue(new Error('runtime down')),
      },
      realm: {},
    });
    bootstrapParentOSAuthSessionMock.mockResolvedValue(undefined);
    dbInitMock.mockResolvedValue(undefined);
    getFamilyMock.mockResolvedValue(null);
    getChildrenMock.mockResolvedValue([]);
    loadPersistedParentosAIConfigMock.mockResolvedValue(null);
  });

  it('keeps bootstrap non-blocking when runtime.ready fails', async () => {
    await runParentOSBootstrap();

    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().bootstrapError).toBe(null);
  });
});
