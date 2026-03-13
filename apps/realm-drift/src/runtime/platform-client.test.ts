import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRuntimeInstance = {
  ready: vi.fn().mockResolvedValue(undefined),
  ai: { text: { stream: vi.fn() } },
};

const mockRealmInstance = {
  raw: { request: vi.fn().mockResolvedValue({}) },
};

vi.mock('@nimiplatform/sdk/runtime', () => ({
  Runtime: class MockRuntime {
    appId: string;
    constructor(opts: Record<string, unknown>) {
      this.appId = opts.appId as string;
      Object.assign(this, mockRuntimeInstance);
    }
  },
}));

vi.mock('@nimiplatform/sdk/realm', () => ({
  Realm: class MockRealm {
    baseUrl: string;
    raw = mockRealmInstance.raw;
    constructor(opts: Record<string, unknown>) {
      this.baseUrl = opts.baseUrl as string;
    }
  },
}));

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: {
    getState: vi.fn().mockReturnValue({
      auth: { token: '', refreshToken: '', user: null },
    }),
  },
}));

import { initializePlatformClient, getPlatformClient } from './platform-client.js';

describe('platform-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with realm-drift appId', async () => {
    const client = await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessToken: 'test-token',
    });

    expect(client.runtime).toBeTruthy();
    expect(client.realm).toBeTruthy();
    expect((client.runtime as unknown as { appId: string }).appId).toBe('nimi.realm-drift');
  });

  it('getPlatformClient returns initialized client', async () => {
    await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessToken: 'test-token',
    });

    const client = getPlatformClient();
    expect(client.runtime).toBeTruthy();
    expect(client.realm).toBeTruthy();
  });

  it('creates realm client with correct baseUrl', async () => {
    const client = await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessToken: 'my-jwt-token',
    });

    expect((client.realm as unknown as { baseUrl: string }).baseUrl).toBe('http://localhost:3002');
  });
});
