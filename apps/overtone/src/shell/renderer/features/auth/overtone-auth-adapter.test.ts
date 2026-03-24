import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCurrentUser = vi.fn();
const mockCreatePlatformClient = vi.fn(async () => ({
  domains: {
    auth: {
      getCurrentUser: mockGetCurrentUser,
    },
  },
}));
const mockClearPlatformClient = vi.fn();

vi.stubEnv('VITE_NIMI_REALM_BASE_URL', 'https://realm.example.com');

vi.mock('@renderer/bridge/oauth.js', () => ({
  overtoneTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('@nimiplatform/sdk', () => ({
  createPlatformClient: mockCreatePlatformClient,
  clearPlatformClient: mockClearPlatformClient,
}));

const {
  createOvertoneDesktopBrowserAuthAdapter,
  resolveOvertoneCurrentUser,
} = await import('./overtone-auth-adapter.js');

describe('overtone-auth-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes the platform client when applying a token', async () => {
    const adapter = createOvertoneDesktopBrowserAuthAdapter();

    await adapter.applyToken('overtone-access-token');

    expect(mockCreatePlatformClient).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'nimi.overtone',
      realmBaseUrl: 'https://realm.example.com',
      accessToken: 'overtone-access-token',
      allowAnonymousRealm: true,
    }));
  });

  it('loads and normalizes the current user profile via auth.getCurrentUser', async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: 'ot-user',
      name: 'Overtone User',
    });

    await expect(resolveOvertoneCurrentUser('token')).resolves.toEqual({
      id: 'ot-user',
      name: 'Overtone User',
      displayName: 'Overtone User',
    });

    expect(mockGetCurrentUser).toHaveBeenCalledWith();
  });
});
