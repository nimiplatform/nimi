import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '@renderer/app-shell/app-store.js';

const mockGetMe = vi.fn();

const mockRealm = {
  services: {
    MeService: {
      getMe: (...args: unknown[]) => mockGetMe(...args),
    },
  },
};

import { bootstrapAuthSession } from './drift-bootstrap-auth.js';

function makeBootstrapInput(
  overrides: Partial<Omit<Parameters<typeof bootstrapAuthSession>[0], 'realm' | 'accessToken'>> = {},
) {
  return {
    source: 'env' as const,
    realmBaseUrl: 'https://realm.example.test',
    clearPersistedSession: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('bootstrapAuthSession', () => {
  beforeEach(() => {
    mockGetMe.mockReset();
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: '' },
    });
  });

  it('sets auth session when token is valid and user data returned', async () => {
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: 'refresh-abc' },
    });

    mockGetMe.mockResolvedValue({
      id: 'u1',
      displayName: 'Test User',
      email: 'test@example.com',
      avatarUrl: 'https://example.com/avatar.jpg',
    });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'valid-token',
      ...makeBootstrapInput(),
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('authenticated');
    expect(state.auth.user).toEqual({
      id: 'u1',
      displayName: 'Test User',
      email: 'test@example.com',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    expect(state.auth.token).toBe('valid-token');
    expect(state.auth.refreshToken).toBe('refresh-abc');
  });

  it('sets auth session with fallback name field', async () => {
    mockGetMe.mockResolvedValue({
      id: 'u2',
      name: 'Fallback Name',
    });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'token-2',
      ...makeBootstrapInput(),
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('authenticated');
    expect(state.auth.user?.displayName).toBe('Fallback Name');
    expect(state.auth.user?.email).toBeUndefined();
    expect(state.auth.user?.avatarUrl).toBeUndefined();
  });

  it('clears auth session when no access token provided', async () => {
    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: '',
      ...makeBootstrapInput(),
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('unauthenticated');
    expect(state.auth.user).toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it('clears auth session when MeService.getMe fails', async () => {
    mockGetMe.mockRejectedValue(new Error('Network error'));

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'bad-token',
      ...makeBootstrapInput(),
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('unauthenticated');
    expect(state.auth.user).toBeNull();
  });

  it('clears auth session when no user in response', async () => {
    mockGetMe.mockResolvedValue(null);

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'valid-token',
      ...makeBootstrapInput(),
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('unauthenticated');
    expect(state.auth.user).toBeNull();
  });

  it('clears auth session when user has no id', async () => {
    mockGetMe.mockResolvedValue({ displayName: 'No ID User' });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'valid-token',
      ...makeBootstrapInput(),
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('unauthenticated');
    expect(state.auth.user).toBeNull();
  });

  it('calls MeService.getMe to bootstrap the current user', async () => {
    mockGetMe.mockResolvedValue({ id: 'u1', displayName: 'Test' });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'token',
      ...makeBootstrapInput(),
    });

    expect(mockGetMe).toHaveBeenCalledWith();
  });
});
