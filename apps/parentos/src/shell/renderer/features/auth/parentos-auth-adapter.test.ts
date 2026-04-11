import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateAuth = vi.fn();
const mockRequest = vi.fn();
const mockRunParentOSBootstrap = vi.fn(async () => undefined);

vi.mock('../../bridge/index.js', () => ({
  parentosTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('../../infra/parentos-bootstrap.js', () => ({
  ensureParentOSBootstrapReady: mockRunParentOSBootstrap,
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
  createParentOSDesktopBrowserAuthAdapter,
  loadCurrentUser,
} = await import('./parentos-auth-adapter.js');

describe('parentos-auth-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for ParentOS bootstrap before applying access and refresh tokens', async () => {
    const adapter = createParentOSDesktopBrowserAuthAdapter();

    await adapter.applyToken('access-token', 'refresh-token');

    expect(mockRunParentOSBootstrap).toHaveBeenCalledTimes(1);
    expect(mockUpdateAuth).toHaveBeenCalledTimes(1);
    const authConfig = mockUpdateAuth.mock.calls[0]?.[0] as {
      accessToken: () => string;
      refreshToken: () => string;
    };
    expect(authConfig.accessToken()).toBe('access-token');
    expect(authConfig.refreshToken()).toBe('refresh-token');
  });

  it('waits for ParentOS bootstrap before loading and normalizing the current user', async () => {
    mockRequest.mockResolvedValue({
      id: 'parent-user',
      name: 'Parent User',
      email: 'parent@example.com',
    });

    await expect(loadCurrentUser()).resolves.toEqual({
      id: 'parent-user',
      name: 'Parent User',
      displayName: 'Parent User',
      email: 'parent@example.com',
    });

    expect(mockRunParentOSBootstrap).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith();
  });
});
