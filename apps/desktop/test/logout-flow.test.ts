import assert from 'node:assert/strict';
import test from 'node:test';

import { logoutAndClearSession } from '../src/shell/renderer/features/auth/logout';

function createTranslate() {
  return (_key: string, options?: { defaultValue?: string; error?: string }) =>
    String(options?.defaultValue || options?.error || '');
}

test('logout flow clears local state and emits success banner after successful logout', async () => {
  const effects: string[] = [];
  let banner: { kind: string; message: string } | null = null;

  await logoutAndClearSession(
    {
      clearAuthSession: () => {
        effects.push('clear-auth');
      },
      setStatusBanner: (value) => {
        banner = value;
      },
    },
    {
      logout: async () => {
        effects.push('server-logout');
      },
      clearPersistedAccessToken: () => {
        effects.push('clear-token');
      },
      clearAllStreams: () => {
        effects.push('clear-streams');
      },
      clearQueryClient: () => {
        effects.push('clear-query');
      },
      translate: createTranslate(),
    },
  );

  assert.deepEqual(effects, [
    'server-logout',
    'clear-token',
    'clear-streams',
    'clear-auth',
    'clear-query',
  ]);
  assert.deepEqual(banner, {
    kind: 'info',
    message: 'Signed out',
  });
});

test('logout flow distinguishes transient server logout failures while still clearing local state', async () => {
  const effects: string[] = [];
  let banner: { kind: string; message: string } | null = null;

  await logoutAndClearSession(
    {
      clearAuthSession: () => {
        effects.push('clear-auth');
      },
      setStatusBanner: (value) => {
        banner = value;
      },
    },
    {
      logout: async () => {
        effects.push('server-logout');
        throw new Error('network timeout');
      },
      clearPersistedAccessToken: () => {
        effects.push('clear-token');
      },
      clearAllStreams: () => {
        effects.push('clear-streams');
      },
      clearQueryClient: () => {
        effects.push('clear-query');
      },
      translate: createTranslate(),
    },
  );

  assert.deepEqual(effects, [
    'server-logout',
    'clear-token',
    'clear-streams',
    'clear-auth',
    'clear-query',
  ]);
  assert.equal(banner?.kind, 'warning');
  assert.match(String(banner?.message || ''), /network error/i);
});
