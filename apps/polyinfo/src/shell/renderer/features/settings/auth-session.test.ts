import { describe, expect, it, vi } from 'vitest';
import {
  applyPolyinfoAccessTokenSession,
  normalizePolyinfoAuthUser,
} from './auth-session.js';

describe('polyinfo auth session', () => {
  it('applies the browser auth token before loading and persisting the current user', async () => {
    const calls: string[] = [];
    let activeToken = '';
    const realm = {
      updateAuth: vi.fn((patch: { accessToken?: () => string }) => {
        calls.push('updateAuth');
        activeToken = patch.accessToken?.() ?? '';
      }),
      services: {
        MeService: {
          getMe: vi.fn(async () => {
            calls.push(`getMe:${activeToken}`);
            return {
              id: 'user-1',
              name: 'Ada',
              email: 'ada@example.com',
            };
          }),
        },
      },
    };
    const setAuthSession = vi.fn(() => {
      calls.push('setAuthSession');
    });
    const persistSession = vi.fn(async () => {
      calls.push('persistSession');
    });

    const user = await applyPolyinfoAccessTokenSession({
      realm,
      accessToken: ' access-token ',
      setAuthSession,
      persistSession,
    });

    expect(user).toEqual({
      id: 'user-1',
      displayName: 'Ada',
      email: 'ada@example.com',
      avatarUrl: undefined,
    });
    expect(calls).toEqual([
      'updateAuth',
      'getMe:access-token',
      'setAuthSession',
      'persistSession',
    ]);
    expect(setAuthSession).toHaveBeenCalledWith(user, 'access-token', '');
    expect(persistSession).toHaveBeenCalledWith({
      accessToken: 'access-token',
      refreshToken: '',
      user,
    });
  });

  it('rejects incomplete user payloads', () => {
    expect(() => normalizePolyinfoAuthUser({ displayName: 'Missing id' })).toThrow('登录返回不完整');
  });
});
