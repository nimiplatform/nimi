import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@nimiplatform/sdk', () => ({}));

const { useAppStore } = await import('@renderer/app-shell/providers/app-store.js');
const { bootstrapAuthSession } = await import('./forge-bootstrap-auth.js');

function makeMockRealm(response: Record<string, unknown> | Error) {
  return {
    services: {
      MeService: {
        getMe: vi.fn().mockImplementation(() => {
          if (response instanceof Error) return Promise.reject(response);
          return Promise.resolve(response);
        }),
      },
    },
  } as unknown as Parameters<typeof bootstrapAuthSession>[0]['realm'];
}

describe('bootstrapAuthSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: '' },
    });
  });

  it('clears session when no accessToken provided', async () => {
    const realm = makeMockRealm({ user: { id: 'u1' } });
    await bootstrapAuthSession({ realm, accessToken: '' });
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
    expect(realm.services.MeService.getMe).not.toHaveBeenCalled();
  });

  it('fetches the current user through MeService.getMe and sets session', async () => {
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: 'refresh-abc' },
    });
    const realm = makeMockRealm({
      id: 'user-123',
      displayName: 'Test User',
      email: 'test@example.com',
      avatarUrl: 'https://img.example.com/avatar.png',
    });

    await bootstrapAuthSession({ realm, accessToken: 'access-token-xyz' });

    expect(realm.services.MeService.getMe).toHaveBeenCalledWith();

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('authenticated');
    expect(state.auth.user?.id).toBe('user-123');
    expect(state.auth.user?.displayName).toBe('Test User');
    expect(state.auth.user?.email).toBe('test@example.com');
    expect(state.auth.token).toBe('access-token-xyz');
    expect(state.auth.refreshToken).toBe('refresh-abc');
  });

  it('clears session when /api/auth/me returns no user', async () => {
    const realm = makeMockRealm(null as unknown as Record<string, unknown>);
    await bootstrapAuthSession({ realm, accessToken: 'token' });
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('clears session when /api/auth/me returns user without id', async () => {
    const realm = makeMockRealm({ displayName: 'No ID' });
    await bootstrapAuthSession({ realm, accessToken: 'token' });
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('clears session on request error', async () => {
    const realm = makeMockRealm(new Error('Network error'));
    await bootstrapAuthSession({ realm, accessToken: 'token' });
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('handles missing optional fields gracefully', async () => {
    const realm = makeMockRealm({ id: 'u1', name: 'Fallback Name' });

    await bootstrapAuthSession({ realm, accessToken: 'token' });

    const state = useAppStore.getState();
    expect(state.auth.user?.displayName).toBe('Fallback Name');
    expect(state.auth.user?.email).toBeUndefined();
    expect(state.auth.user?.avatarUrl).toBeUndefined();
    expect(state.auth.refreshToken).toBe('');
  });
});
