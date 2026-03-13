import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track the mock realm instance created during each init call
let latestRealmInstance: {
  raw: { request: ReturnType<typeof vi.fn> };
  updateAuth: ReturnType<typeof vi.fn>;
  clearAuth: ReturnType<typeof vi.fn>;
};
let latestRealmOptions: Record<string, unknown> | null = null;

vi.mock('@nimiplatform/sdk/runtime', () => ({
  Runtime: class MockRuntime {
    ready = vi.fn().mockResolvedValue(undefined);
    constructor(_opts: unknown) {}
  },
}));

vi.mock('@nimiplatform/sdk/realm', () => ({
  Realm: class MockRealm {
    raw = { request: vi.fn().mockResolvedValue({}) };
    updateAuth = vi.fn();
    clearAuth = vi.fn();

    constructor(opts: unknown) {
      latestRealmOptions = opts as Record<string, unknown>;
      latestRealmInstance = this as typeof latestRealmInstance;
    }
  },
}));

const { useAppStore } = await import('@renderer/app-shell/providers/app-store.js');
const { initializePlatformClient, getPlatformClient } = await import('./platform-client.js');

describe('platform-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestRealmOptions = null;
    useAppStore.setState({
      auth: { status: 'authenticated', user: { id: 'u1', displayName: 'Test' }, token: 'old-token', refreshToken: 'refresh-tok' },
    });
  });

  it('initializePlatformClient creates runtime and realm', async () => {
    const client = await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessToken: 'test-token',
    });

    expect(client.runtime).toBeDefined();
    expect(client.realm).toBeDefined();
  });

  it('getPlatformClient returns the initialized client', async () => {
    await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessToken: 'test-token',
    });

    const client = getPlatformClient();
    expect(client).toBeDefined();
  });

  describe('realm auth wiring', () => {
    it('constructs Realm with function auth providers and refresh callbacks', async () => {
      await initializePlatformClient({
        realmBaseUrl: 'http://localhost:3002',
        accessToken: 'bootstrap-token',
      });

      expect(latestRealmOptions).toBeTruthy();
      const auth = (latestRealmOptions as { auth?: Record<string, unknown> }).auth;
      expect(auth).toBeTruthy();
      expect(typeof auth?.accessToken).toBe('function');
      expect(typeof auth?.refreshToken).toBe('function');
      expect(typeof auth?.onTokenRefreshed).toBe('function');
      expect(typeof auth?.onRefreshFailed).toBe('function');
    });

    it('accessToken provider prefers store token and falls back to bootstrap token only during bootstrapping', async () => {
      useAppStore.setState({
        auth: { status: 'bootstrapping', user: null, token: '', refreshToken: '' },
      });
      await initializePlatformClient({
        realmBaseUrl: 'http://localhost:3002',
        accessToken: 'bootstrap-token',
      });

      const auth = (latestRealmOptions as { auth: { accessToken: () => Promise<string>; refreshToken: () => string } }).auth;
      await expect(auth.accessToken()).resolves.toBe('bootstrap-token');

      useAppStore.setState({
        auth: { status: 'authenticated', user: { id: 'u1', displayName: 'Test' }, token: 'live-token', refreshToken: 'rt-1' },
      });
      await expect(auth.accessToken()).resolves.toBe('live-token');
      expect(auth.refreshToken()).toBe('rt-1');
    });

    it('onTokenRefreshed updates the store tokens', async () => {
      await initializePlatformClient({
        realmBaseUrl: 'http://localhost:3002',
        accessToken: 'token',
      });

      const auth = (latestRealmOptions as { auth: { onTokenRefreshed: (result: { accessToken: string; refreshToken?: string }) => void } }).auth;
      auth.onTokenRefreshed({ accessToken: 'fresh-token', refreshToken: 'fresh-refresh' });

      expect(useAppStore.getState().auth.token).toBe('fresh-token');
      expect(useAppStore.getState().auth.refreshToken).toBe('fresh-refresh');
    });

    it('onRefreshFailed clears both Realm auth and the store session', async () => {
      await initializePlatformClient({
        realmBaseUrl: 'http://localhost:3002',
        accessToken: 'token',
      });

      const auth = (latestRealmOptions as { auth: { onRefreshFailed: () => void } }).auth;
      auth.onRefreshFailed();

      expect(latestRealmInstance.clearAuth).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().auth.status).toBe('unauthenticated');
      expect(useAppStore.getState().auth.token).toBe('');
    });
  });
});
