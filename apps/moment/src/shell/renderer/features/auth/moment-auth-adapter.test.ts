import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateAuth = vi.fn();
const mockRequest = vi.fn();
const mockEnsureMomentBootstrapReady = vi.fn(async () => undefined);

vi.mock('@renderer/bridge/oauth.js', () => ({
  momentTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('@renderer/infra/bootstrap/moment-bootstrap.js', () => ({
  ensureMomentBootstrapReady: mockEnsureMomentBootstrapReady,
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
  createMomentDesktopBrowserAuthAdapter,
  loadMomentCurrentUser,
} = await import('./moment-auth-adapter.js');

describe('moment-auth-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for Moment bootstrap before applying access and refresh tokens', async () => {
    const adapter = createMomentDesktopBrowserAuthAdapter();

    await adapter.applyToken('access-token', 'refresh-token');

    expect(mockEnsureMomentBootstrapReady).toHaveBeenCalledTimes(1);
    expect(mockUpdateAuth).toHaveBeenCalledTimes(1);
    const authConfig = mockUpdateAuth.mock.calls[0]?.[0] as {
      accessToken: () => string;
      refreshToken: () => string;
    };
    expect(authConfig.accessToken()).toBe('access-token');
    expect(authConfig.refreshToken()).toBe('refresh-token');
  });

  it('waits for Moment bootstrap before loading and normalizing the current user', async () => {
    mockRequest.mockResolvedValue({
      id: 'moment-user',
      name: 'Moment User',
      email: 'moment@example.com',
    });

    await expect(loadMomentCurrentUser()).resolves.toEqual({
      id: 'moment-user',
      name: 'Moment User',
      displayName: 'Moment User',
      email: 'moment@example.com',
    });

    expect(mockEnsureMomentBootstrapReady).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith();
  });
});
