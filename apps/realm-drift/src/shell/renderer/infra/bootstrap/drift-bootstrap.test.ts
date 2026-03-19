import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '@renderer/app-shell/app-store.js';

const mockGetRuntimeDefaults = vi.fn();
const mockInitializePlatformClient = vi.fn();
const mockInitI18n = vi.fn();

vi.mock('@renderer/bridge/runtime-defaults.js', () => ({
  getRuntimeDefaults: (...args: unknown[]) => mockGetRuntimeDefaults(...args),
}));

vi.mock('@runtime/platform-client.js', () => ({
  initializePlatformClient: (...args: unknown[]) => mockInitializePlatformClient(...args),
  getPlatformClient: vi.fn(),
}));

vi.mock('@renderer/i18n/index.js', () => ({
  initI18n: (...args: unknown[]) => mockInitI18n(...args),
}));

import { runDriftBootstrap } from './drift-bootstrap.js';

const MOCK_DEFAULTS = {
  realm: {
    realmBaseUrl: 'http://localhost:3002',
    realtimeUrl: '',
    accessToken: 'test-token',
    jwksUrl: 'http://localhost:3002/api/auth/jwks',
    jwtIssuer: 'http://localhost:3002',
    jwtAudience: 'nimi-runtime',
  },
  runtime: {
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'local-model',
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

describe('runDriftBootstrap', () => {
  beforeEach(() => {
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: '' },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
    });

    mockInitI18n.mockResolvedValue(undefined);
    mockGetRuntimeDefaults.mockResolvedValue(MOCK_DEFAULTS);
    mockInitializePlatformClient.mockResolvedValue({
      runtime: { ready: vi.fn().mockResolvedValue(undefined) },
      realm: {
        services: {
          MeService: {
            getMe: vi.fn().mockResolvedValue({
              id: 'u1',
              displayName: 'Test User',
              email: 'test@example.com',
            }),
          },
        },
      },
    });
  });

  it('runs 5-step bootstrap successfully', async () => {
    await runDriftBootstrap();

    const state = useAppStore.getState();
    expect(state.bootstrapReady).toBe(true);
    expect(state.bootstrapError).toBeNull();
    expect(state.runtimeDefaults).toBeTruthy();
    expect(state.auth.status).toBe('authenticated');
    expect(state.auth.user?.id).toBe('u1');
  });

  it('sets error on bootstrap failure', async () => {
    mockGetRuntimeDefaults.mockRejectedValue(new Error('Network error'));

    await runDriftBootstrap();

    const state = useAppStore.getState();
    expect(state.bootstrapError).toBe('Network error');
    expect(state.bootstrapReady).toBe(false);
  });

  it('sets unauthenticated when no access token', async () => {
    mockGetRuntimeDefaults.mockResolvedValue({
      ...MOCK_DEFAULTS,
      realm: { ...MOCK_DEFAULTS.realm, accessToken: '' },
    });

    await runDriftBootstrap();

    const state = useAppStore.getState();
    expect(state.bootstrapReady).toBe(true);
    expect(state.auth.status).toBe('unauthenticated');
  });
});
