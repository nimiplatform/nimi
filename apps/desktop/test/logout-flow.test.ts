import assert from 'node:assert/strict';
import test from 'node:test';

import { logoutAndClearSession } from '../src/shell/renderer/features/auth/logout';

function createTranslate() {
  return (_key: string, options?: { defaultValue?: string; error?: string }) =>
    String(options?.defaultValue || options?.error || '');
}

test('logout flow clears local state and emits success banner after successful logout', async () => {
  const effects: string[] = [];
  let bannerKind: string | null = null;
  let bannerMessage = '';

  await logoutAndClearSession(
    {
      clearAuthSession: () => {
        effects.push('clear-auth');
      },
      setStatusBanner: (value) => {
        bannerKind = value?.kind ?? null;
        bannerMessage = value?.message ?? '';
      },
    },
    {
      logout: async () => {
        effects.push('server-logout');
      },
      clearPersistedSession: () => {
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
  assert.equal(bannerKind, 'info');
  assert.equal(bannerMessage, 'Signed out');
});

test('logout flow distinguishes transient server logout failures while still clearing local state', async () => {
  const effects: string[] = [];
  let bannerKind: string | null = null;
  let bannerMessage = '';

  await logoutAndClearSession(
    {
      clearAuthSession: () => {
        effects.push('clear-auth');
      },
      setStatusBanner: (value) => {
        bannerKind = value?.kind ?? null;
        bannerMessage = value?.message ?? '';
      },
    },
    {
      logout: async () => {
        effects.push('server-logout');
        throw new Error('network timeout');
      },
      clearPersistedSession: () => {
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
  assert.equal(bannerKind, 'warning');
  assert.match(bannerMessage, /network error/i);
});
