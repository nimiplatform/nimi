import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { logoutAndClearSession } from '../src/shell/renderer/features/auth/logout';

const logoutSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/logout.ts'),
  'utf8',
);

function createTranslate() {
  return (_key: string, options?: { defaultValue?: string; error?: string }) =>
    String(options?.defaultValue || options?.error || '');
}

test('logout flow clears local state only after Runtime logout succeeds', async () => {
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

test('logout flow fails closed when Runtime logout cannot be confirmed', async () => {
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
  ]);
  assert.equal(bannerKind, 'warning');
  assert.match(bannerMessage, /could not be completed/i);
});

test('logout flow does not bypass Runtime logout for Desktop shells', () => {
  assert.doesNotMatch(logoutSource, /isDesktopRuntimeAccountSessionReady/);
  assert.match(logoutSource, /getDesktopAccountRuntime\(\)\.account\.logout/);
});
