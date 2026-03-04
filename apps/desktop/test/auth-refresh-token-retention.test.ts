import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createAuthSlice } from '../src/shell/renderer/app-shell/providers/store-slices/auth-slice';

const authMenuSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/auth-menu.tsx'),
  'utf8',
);
const authDesktopAuthorizeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/auth-menu-handlers-ext.ts'),
  'utf8',
);

test('setAuthSession keeps existing refresh token when refreshToken is undefined', () => {
  let state: Record<string, unknown> = {
    auth: {
      status: 'anonymous',
      user: null,
      token: '',
      refreshToken: '',
    },
    selectedChatId: null,
  };
  const set = (partial: unknown) => {
    const next = typeof partial === 'function'
      ? (partial as (prev: Record<string, unknown>) => Record<string, unknown>)(state)
      : (partial as Record<string, unknown>);
    state = {
      ...state,
      ...next,
    };
  };
  const slice = createAuthSlice(set as never);

  slice.setAuthSession({ id: 'u1' }, 'access-1', 'refresh-1');
  assert.equal((state.auth as { refreshToken: string }).refreshToken, 'refresh-1');

  slice.setAuthSession({ id: 'u1' }, 'access-2');
  assert.equal((state.auth as { refreshToken: string }).refreshToken, 'refresh-1');

  slice.setAuthSession({ id: 'u1' }, 'access-3', '');
  assert.equal((state.auth as { refreshToken: string }).refreshToken, '');
});

test('auth menu storage sync forwards persisted refresh token when available', () => {
  assert.match(authMenuSource, /setAuthSession\(latestUser, latestToken, latestRefreshToken \|\| undefined\)/);
  assert.match(authMenuSource, /dataSync\.setRefreshToken\(latestRefreshToken\)/);
});

test('desktop authorization keeps refresh token in auth store', () => {
  assert.match(
    authDesktopAuthorizeSource,
    /setAuthSession\(\s*normalizedUser,\s*accessToken,\s*latestPersistedAuthSession\?\.refreshToken \|\| undefined,\s*\)/,
  );
});
