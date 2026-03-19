import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateAuth = vi.fn();
const mockRequest = vi.fn();

vi.mock('@renderer/bridge/oauth.js', () => ({
  forgeTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('@runtime/platform-client.js', () => ({
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
  createForgeDesktopBrowserAuthAdapter,
  loadForgeCurrentUser,
} = await import('./forge-auth-adapter.js');

describe('forge-auth-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies access and refresh tokens to the platform realm client', async () => {
    const adapter = createForgeDesktopBrowserAuthAdapter();

    await adapter.applyToken('access-token', 'refresh-token');

    expect(mockUpdateAuth).toHaveBeenCalledTimes(1);
    const authConfig = mockUpdateAuth.mock.calls[0]?.[0] as {
      accessToken: () => string;
      refreshToken: () => string;
    };
    expect(authConfig.accessToken()).toBe('access-token');
    expect(authConfig.refreshToken()).toBe('refresh-token');
  });

  it('loads and normalizes the current user profile via MeService.getMe', async () => {
    mockRequest.mockResolvedValue({
      id: 'forge-user',
      name: 'Forge User',
      email: 'forge@example.com',
    });

    await expect(loadForgeCurrentUser()).resolves.toEqual({
      id: 'forge-user',
      name: 'Forge User',
      displayName: 'Forge User',
      email: 'forge@example.com',
    });

    expect(mockRequest).toHaveBeenCalledWith();
  });
});
