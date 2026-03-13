import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '@renderer/app-shell/app-store.js';

const mockRequest = vi.fn();

const mockRealm = {
  raw: {
    request: (...args: unknown[]) => mockRequest(...args),
  },
};

import { bootstrapAuthSession } from './drift-bootstrap-auth.js';

describe('bootstrapAuthSession', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: '' },
    });
  });

  it('sets auth session when token is valid and user data returned', async () => {
    mockRequest.mockResolvedValue({
      user: {
        id: 'u1',
        displayName: 'Test User',
        email: 'test@example.com',
        avatarUrl: 'https://example.com/avatar.jpg',
      },
      refreshToken: 'refresh-abc',
    });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'valid-token',
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
    mockRequest.mockResolvedValue({
      user: {
        id: 'u2',
        name: 'Fallback Name',
      },
      refreshToken: '',
    });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'token-2',
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
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('unauthenticated');
    expect(state.auth.user).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('clears auth session when API call fails', async () => {
    mockRequest.mockRejectedValue(new Error('Network error'));

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'bad-token',
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('unauthenticated');
    expect(state.auth.user).toBeNull();
  });

  it('clears auth session when no user in response', async () => {
    mockRequest.mockResolvedValue({
      user: null,
      refreshToken: 'some-token',
    });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'valid-token',
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('unauthenticated');
    expect(state.auth.user).toBeNull();
  });

  it('clears auth session when user has no id', async () => {
    mockRequest.mockResolvedValue({
      user: { displayName: 'No ID User' },
      refreshToken: '',
    });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'valid-token',
    });

    const state = useAppStore.getState();
    expect(state.auth.status).toBe('unauthenticated');
    expect(state.auth.user).toBeNull();
  });

  it('calls realm.raw.request with GET /api/auth/me', async () => {
    mockRequest.mockResolvedValue({
      user: { id: 'u1', displayName: 'Test' },
      refreshToken: '',
    });

    await bootstrapAuthSession({
      realm: mockRealm as never,
      accessToken: 'token',
    });

    expect(mockRequest).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/auth/me',
    });
  });
});
