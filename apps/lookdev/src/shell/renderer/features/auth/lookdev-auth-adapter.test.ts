import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateAuth = vi.fn();
const mockRequest = vi.fn();
const mockEnsureLookdevBootstrapReady = vi.fn(async () => undefined);

vi.mock('@renderer/bridge', () => ({
  lookdevTauriOAuthBridge: { openExternalUrl: vi.fn() },
  clearAuthSession: vi.fn(),
  saveAuthSession: vi.fn(),
}));

vi.mock('@renderer/infra/bootstrap/lookdev-bootstrap.js', () => ({
  ensureLookdevBootstrapReady: mockEnsureLookdevBootstrapReady,
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    realm: {
      updateAuth: mockUpdateAuth,
      services: {
        MeService: {
          getMe: mockRequest,
        },
      },
    },
  }),
}));

const {
  createLookdevDesktopBrowserAuthAdapter,
  loadLookdevCurrentUser,
} = await import('./lookdev-auth-adapter.js');

describe('lookdev-auth-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for Lookdev bootstrap before applying access and refresh tokens', async () => {
    const adapter = createLookdevDesktopBrowserAuthAdapter();

    await adapter.applyToken('access-token', 'refresh-token');

    expect(mockEnsureLookdevBootstrapReady).toHaveBeenCalledTimes(1);
    expect(mockUpdateAuth).toHaveBeenCalledTimes(1);
    const authConfig = mockUpdateAuth.mock.calls[0]?.[0] as {
      accessToken: () => string;
      refreshToken: () => string;
    };
    expect(authConfig.accessToken()).toBe('access-token');
    expect(authConfig.refreshToken()).toBe('refresh-token');
  });

  it('waits for Lookdev bootstrap before loading and normalizing the current user', async () => {
    mockRequest.mockResolvedValue({
      id: 'lookdev-user',
      name: 'Lookdev User',
      email: 'lookdev@example.com',
    });

    await expect(loadLookdevCurrentUser()).resolves.toEqual({
      id: 'lookdev-user',
      name: 'Lookdev User',
      displayName: 'Lookdev User',
      email: 'lookdev@example.com',
    });

    expect(mockEnsureLookdevBootstrapReady).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith();
  });
});
