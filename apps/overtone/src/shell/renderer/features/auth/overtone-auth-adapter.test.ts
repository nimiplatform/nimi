import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
const mockInitRealmInstance = vi.fn(() => ({
  raw: {
    request: mockRequest,
  },
}));
const mockGetRealmInstance = vi.fn(() => null);
const mockClearRealmInstance = vi.fn();

vi.stubEnv('VITE_NIMI_REALM_BASE_URL', 'https://realm.example.com');

vi.mock('@renderer/bridge/oauth.js', () => ({
  overtoneTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('@renderer/bridge/realm-sdk.js', () => ({
  initRealmInstance: mockInitRealmInstance,
  getRealmInstance: mockGetRealmInstance,
  clearRealmInstance: mockClearRealmInstance,
}));

const {
  createOvertoneDesktopBrowserAuthAdapter,
  resolveOvertoneCurrentUser,
} = await import('./overtone-auth-adapter.js');

describe('overtone-auth-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes realm auth when applying a token', async () => {
    const adapter = createOvertoneDesktopBrowserAuthAdapter();

    await adapter.applyToken('overtone-access-token');

    expect(mockInitRealmInstance).toHaveBeenCalledWith(
      'https://realm.example.com',
      'overtone-access-token',
    );
  });

  it('loads and normalizes the current user profile', async () => {
    mockRequest.mockResolvedValue({
      user: {
        id: 'ot-user',
        name: 'Overtone User',
      },
    });

    await expect(resolveOvertoneCurrentUser('token')).resolves.toEqual({
      id: 'ot-user',
      name: 'Overtone User',
      displayName: 'Overtone User',
    });

    expect(mockRequest).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/auth/me',
    });
  });
});
