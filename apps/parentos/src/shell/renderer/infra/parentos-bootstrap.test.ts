import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRuntimeDefaultsMock = vi.fn();
const resolveDesktopBootstrapAuthSessionMock = vi.fn();
const createPlatformClientMock = vi.fn();
const bootstrapParentOSAuthSessionMock = vi.fn();
const dbInitMock = vi.fn();
const getAppSettingMock = vi.fn();
const getChildMock = vi.fn();
const getFamilyMock = vi.fn();
const getChildrenMock = vi.fn();
const loadPersistedParentosAIConfigMock = vi.fn();
const mapChildRowMock = vi.fn();

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
  getAppSetting: getAppSettingMock,
  getChild: getChildMock,
  getFamily: getFamilyMock,
  getChildren: getChildrenMock,
}));

vi.mock('../bridge/mappers.js', () => ({
  mapChildRow: mapChildRowMock,
}));

vi.mock('./parentos-bootstrap-auth.js', () => ({
  bootstrapParentOSAuthSession: bootstrapParentOSAuthSessionMock,
}));

vi.mock('../features/settings/parentos-ai-config.js', () => ({
  loadPersistedParentosAIConfig: loadPersistedParentosAIConfigMock,
}));

let useAppStore: typeof import('../app-shell/app-store.js').useAppStore;
let runParentOSBootstrap: typeof import('./parentos-bootstrap.js').runParentOSBootstrap;
let syncParentOSLocalDataScope: typeof import('./parentos-bootstrap.js').syncParentOSLocalDataScope;

describe('parentos-bootstrap', () => {
  beforeEach(async () => {
    vi.resetModules();

    ({ useAppStore } = await import('../app-shell/app-store.js'));
    ({ runParentOSBootstrap, syncParentOSLocalDataScope } = await import('./parentos-bootstrap.js'));

    getRuntimeDefaultsMock.mockReset();
    resolveDesktopBootstrapAuthSessionMock.mockReset();
    createPlatformClientMock.mockReset();
    bootstrapParentOSAuthSessionMock.mockReset();
    dbInitMock.mockReset();
    getAppSettingMock.mockReset();
    getChildMock.mockReset();
    getFamilyMock.mockReset();
    getChildrenMock.mockReset();
    loadPersistedParentosAIConfigMock.mockReset();
    mapChildRowMock.mockReset();

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
        revocationUrl: 'http://localhost:3002/api/auth/revocation',
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
    getAppSettingMock.mockResolvedValue(null);
    getChildMock.mockResolvedValue(null);
    getFamilyMock.mockResolvedValue(null);
    getChildrenMock.mockResolvedValue([]);
    loadPersistedParentosAIConfigMock.mockResolvedValue(null);
    mapChildRowMock.mockImplementation((row) => row);
  });

  it('keeps bootstrap non-blocking when runtime.ready fails', async () => {
    await runParentOSBootstrap();

    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().bootstrapError).toBe(null);
  });

  it('restores the family that owns the last active child before loading children', async () => {
    getAppSettingMock.mockImplementation(async (key: string) => (key === 'activeChildId' ? 'child-9' : null));
    getChildMock.mockResolvedValue({
      childId: 'child-9',
      familyId: 'family-9',
    });
    getChildrenMock.mockResolvedValue([
      {
        childId: 'child-9',
        familyId: 'family-9',
        displayName: 'Nini',
        gender: 'female',
        birthDate: '2022-01-01',
        birthWeightKg: null,
        birthHeightCm: null,
        birthHeadCircCm: null,
        avatarPath: null,
        nurtureMode: 'balanced',
        nurtureModeOverrides: null,
        allergies: null,
        medicalNotes: null,
        recorderProfiles: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await runParentOSBootstrap();

    expect(dbInitMock).toHaveBeenCalledWith(null);
    expect(getChildrenMock).toHaveBeenCalledWith('family-9');
    expect(useAppStore.getState().familyId).toBe('family-9');
    expect(useAppStore.getState().activeChildId).toBe('child-9');
  });

  it('loads local data from the authenticated subject scope during bootstrap', async () => {
    resolveDesktopBootstrapAuthSessionMock.mockResolvedValue({
      session: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
      shouldClearPersistedSession: false,
      source: 'persisted',
    });
    bootstrapParentOSAuthSessionMock.mockImplementation(async () => {
      useAppStore.getState().setAuthSession(
        {
          id: 'user-42',
          displayName: 'Scoped User',
          email: 'scoped@example.com',
        },
        'access-token',
        'refresh-token',
      );
    });

    await runParentOSBootstrap();

    expect(dbInitMock).toHaveBeenCalledWith('user-42');
  });

  it('clears stale local state before switching to a new account scope', async () => {
    useAppStore.setState({
      familyId: 'family-old',
      children: [{
        childId: 'child-old',
        familyId: 'family-old',
        displayName: 'Old Child',
        gender: 'female',
        birthDate: '2022-01-01',
        birthWeightKg: null,
        birthHeightCm: null,
        birthHeadCircCm: null,
        avatarPath: null,
        nurtureMode: 'balanced',
        nurtureModeOverrides: null,
        allergies: null,
        medicalNotes: null,
        recorderProfiles: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      activeChildId: 'child-old',
      aiConfig: { models: [] } as never,
    });
    dbInitMock.mockImplementation(async () => {
      expect(useAppStore.getState().familyId).toBe(null);
      expect(useAppStore.getState().children).toEqual([]);
      expect(useAppStore.getState().activeChildId).toBe(null);
      expect(useAppStore.getState().aiConfig).toBe(null);
    });
    getFamilyMock.mockResolvedValue({
      familyId: 'family-new',
      displayName: 'New Family',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    getChildrenMock.mockResolvedValue([
      {
        childId: 'child-new',
        familyId: 'family-new',
        displayName: 'New Child',
        gender: 'female',
        birthDate: '2022-01-01',
        birthWeightKg: null,
        birthHeightCm: null,
        birthHeadCircCm: null,
        avatarPath: null,
        nurtureMode: 'balanced',
        nurtureModeOverrides: null,
        allergies: null,
        medicalNotes: null,
        recorderProfiles: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await syncParentOSLocalDataScope('user-99');

    expect(dbInitMock).toHaveBeenCalledWith('user-99');
    expect(useAppStore.getState().familyId).toBe('family-new');
    expect(useAppStore.getState().activeChildId).toBe('child-new');
  });
});
