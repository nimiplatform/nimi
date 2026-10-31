import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiError } from '@nimiplatform/sdk/types';
import { createBrowserSessionReader } from '../src/auth/browser-session-reader.js';

const error = (reasonCode: string) =>
  createNimiError({ reasonCode, source: 'realm', message: reasonCode });
const direct = <T>(work: () => Promise<T>) => work();

test('missing access cookie renews once and then confirms the actual account', async () => {
  let ready = false;
  let renewals = 0;
  const read = createBrowserSessionReader({
    read: async () => {
      if (!ready) throw error('AUTH_REQUIRED');
      return { id: 'account-a' };
    },
    renew: async () => {
      renewals += 1;
      ready = true;
    },
    exclusive: direct,
  });
  assert.deepEqual(await read(), { id: 'account-a' });
  assert.equal(renewals, 1);
});

test('concurrent reads in one page share renewal without storing an authenticated projection', async () => {
  let ready = false;
  let renewals = 0;
  let reads = 0;
  const read = createBrowserSessionReader({
    read: async () => {
      reads += 1;
      if (!ready) throw error('AUTH_TOKEN_EXPIRED');
      return 'account-a';
    },
    renew: async () => {
      renewals += 1;
      ready = true;
    },
    exclusive: direct,
  });
  assert.deepEqual(await Promise.all([read(), read(), read()]), [
    'account-a',
    'account-a',
    'account-a',
  ]);
  assert.equal(renewals, 1);
  assert.equal(reads, 3);
  await read();
  assert.equal(reads, 4);
});

test('a tab rechecks after acquiring the lock and uses renewal completed by another tab', async () => {
  let renewedElsewhere = false;
  const read = createBrowserSessionReader({
    read: async () => {
      if (!renewedElsewhere) throw error('AUTH_REQUIRED');
      return 'current-account';
    },
    renew: async () => assert.fail('Do not rotate the already-renewed cookie again'),
    exclusive: async (work) => {
      renewedElsewhere = true;
      return work();
    },
  });
  assert.equal(await read(), 'current-account');
});

test('revocation, deletion and outages never trigger renewal or become false authentication', async () => {
  for (const code of ['AUTH_SESSION_REVOKED', 'ACCOUNT_DELETED', 'REALM_UNAVAILABLE']) {
    const failure = error(code);
    const read = createBrowserSessionReader({
      read: async () => {
        throw failure;
      },
      renew: async () => assert.fail('Renewal not allowed'),
      exclusive: direct,
    });
    await assert.rejects(read(), (value) => value === failure);
  }
});

test('missing refresh credentials stay anonymous; a renewal outage remains an error', async () => {
  for (const code of ['AUTH_INVALID_REFRESH_TOKEN', 'REALM_UNAVAILABLE']) {
    const initial = error('AUTH_REQUIRED');
    const failure = error(code);
    const read = createBrowserSessionReader({
      read: async () => {
        throw initial;
      },
      renew: async () => {
        throw failure;
      },
      exclusive: direct,
    });
    await assert.rejects(
      read(),
      (value) => value === (code === 'AUTH_INVALID_REFRESH_TOKEN' ? initial : failure),
    );
  }
});
