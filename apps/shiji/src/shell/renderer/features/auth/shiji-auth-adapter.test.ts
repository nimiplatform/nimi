import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateAuth = vi.fn();
const mockRequest = vi.fn();
const mockEnsureShiJiBootstrapReady = vi.fn(async () => undefined);

vi.mock('@renderer/bridge', () => ({
  shijiTauriOAuthBridge: { openExternalUrl: vi.fn() },
  clearAuthSession: vi.fn(),
  saveAuthSession: vi.fn(),
}));

vi.mock('@renderer/app-shell/bootstrap.js', () => ({
  ensureShiJiBootstrapReady: mockEnsureShiJiBootstrapReady,
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
  createShiJiDesktopBrowserAuthAdapter,
  loadShiJiCurrentUser,
} = await import('./shiji-auth-adapter.js');

describe('shiji-auth-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for ShiJi bootstrap before applying access and refresh tokens', async () => {
    const adapter = createShiJiDesktopBrowserAuthAdapter();

    await adapter.applyToken('access-token', 'refresh-token');

    expect(mockEnsureShiJiBootstrapReady).toHaveBeenCalledTimes(1);
    expect(mockUpdateAuth).toHaveBeenCalledTimes(1);
    const authConfig = mockUpdateAuth.mock.calls[0]?.[0] as {
      accessToken: () => string;
      refreshToken: () => string;
    };
    expect(authConfig.accessToken()).toBe('access-token');
    expect(authConfig.refreshToken()).toBe('refresh-token');
  });

  it('waits for ShiJi bootstrap before loading and normalizing the current user', async () => {
    mockRequest.mockResolvedValue({
      id: 'shiji-user',
      name: 'ShiJi User',
      email: 'shiji@example.com',
    });

    await expect(loadShiJiCurrentUser()).resolves.toEqual({
      id: 'shiji-user',
      name: 'ShiJi User',
      displayName: 'ShiJi User',
      email: 'shiji@example.com',
    });

    expect(mockEnsureShiJiBootstrapReady).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith();
  });
});
