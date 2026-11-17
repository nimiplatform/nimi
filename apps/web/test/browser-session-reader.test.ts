import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiError } from '@nimiplatform/sdk/types';
import { BrowserSessionRenewalBlockedError, createBrowserSessionReader, createBrowserSessionRenewal } from '../src/auth/browser-session-reader.js';

const error = (reasonCode: string) =>
  createNimiError({ reasonCode, source: 'realm', message: reasonCode });
const direct = <T>(work: () => Promise<T>) => work();

function renewalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('uncertain rotation cannot be replayed by another reader or a reloaded page', async () => {
  for (const failure of [new TypeError('fetch failed'), new DOMException('Aborted', 'AbortError'),
    createNimiError({ reasonCode: 'AUTH_TOKEN_VERIFICATION_UNAVAILABLE', source: 'realm', message: 'unavailable', details: { status: 503 } })]) {
    const storage = renewalStorage();
    let calls = 0;
    const input = { storage, key: 'origin', renew: async () => { calls++; throw failure; } };
    await assert.rejects(createBrowserSessionRenewal(input).renew(), BrowserSessionRenewalBlockedError);
    await assert.rejects(createBrowserSessionRenewal(input).renew(), BrowserSessionRenewalBlockedError);
    assert.equal(calls, 1);
  }
});

test('only confirmed rate limiting permits a later renewal; successful login releases the uncertain marker', async () => {
  const storage = renewalStorage();
  const limited = createNimiError({ reasonCode: 'AUTH_RATE_LIMITED', source: 'realm', message: 'limited', details: { status: 429 } });
  let attempts = 0;
  const renewal = createBrowserSessionRenewal({ storage, key: 'origin', renew: async () => {
    if (++attempts === 1) throw limited;
  } });
  await assert.rejects(renewal.renew(), (value) => value === limited);
  await renewal.renew();
  assert.equal(attempts, 2);
  storage.setItem('origin', 'pending');
  await assert.rejects(renewal.renew(), BrowserSessionRenewalBlockedError);
  await renewal.confirmLogin(async () => 'signed-in-account');
  await renewal.renew();
  assert.equal(attempts, 3);
});

test('unavailable marker storage fails before dispatch; access reads never remove an uncertain marker', async () => {
  const storage = renewalStorage();
  storage.setItem('origin', 'pending');
  const renewal = createBrowserSessionRenewal({ storage, key: 'origin', renew: async () => assert.fail('must not rotate') });
  const read = createBrowserSessionReader({ read: async () => ({ account: 'still-valid-access' }), renew: renewal.renew, exclusive: direct });
  assert.equal(await read(), 'still-valid-access');
  await assert.rejects(renewal.renew(), BrowserSessionRenewalBlockedError);
  const blocked = createBrowserSessionRenewal({
    storage: { ...storage, setItem: () => { throw new Error('Storage blocked'); } },
    key: 'another-origin', renew: async () => assert.fail('must not dispatch without marker'),
  });
  await assert.rejects(blocked.renew(), BrowserSessionRenewalBlockedError);
});

test('a confirmed rejection retains its reason across readers without another refresh', async () => {
  const storage = renewalStorage();
  const failure = error('AUTH_REFRESH_TOKEN_REPLAY_DETECTED');
  let calls = 0;
  const input = { storage, key: 'origin', renew: async () => { calls++; throw failure; } };
  await assert.rejects(createBrowserSessionRenewal(input).renew(), value => value === failure);
  await assert.rejects(createBrowserSessionRenewal(input).renew(), { reasonCode: 'AUTH_REFRESH_TOKEN_REPLAY_DETECTED' });
  assert.equal(calls, 1);
});

test('a confirmed fresh login does not depend on marker storage; a failed account read never clears it', async () => {
  const storage = renewalStorage();
  storage.setItem('origin', 'pending');
  const renewal = createBrowserSessionRenewal({ storage, key: 'origin', renew: async () => assert.fail('Do not renew during login confirmation') });
  await assert.rejects(renewal.confirmLogin(async () => { throw new Error('Account read failed'); }), /Account read failed/);
  assert.equal(storage.getItem('origin'), 'pending');
  const deniedStorage = createBrowserSessionRenewal({
    storage: {
      getItem: () => { throw new DOMException('Storage denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('Storage denied', 'SecurityError'); },
      removeItem: () => { throw new DOMException('Storage denied', 'SecurityError'); },
    },
    key: 'origin', renew: async () => assert.fail('Unsafe automatic renewal'),
  });
  await assert.rejects(deniedStorage.renew(), BrowserSessionRenewalBlockedError);
  assert.deepEqual(await deniedStorage.confirmLogin(async () => ({ id: 'new-session-account' })), { id: 'new-session-account' });
});

test('missing access cookie renews once and then confirms the actual account', async () => {
  let ready = false;
  let renewals = 0;
  const read = createBrowserSessionReader<{ id: string }>({
    read: async () => ready ? { account: { id: 'account-a' } } : { error: error('AUTH_REQUIRED') },
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
  const read = createBrowserSessionReader<string>({
    read: async () => {
      reads += 1;
      return ready ? { account: 'account-a' } : { error: error('AUTH_TOKEN_EXPIRED') };
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
  const read = createBrowserSessionReader<string>({
    read: async () => renewedElsewhere ? { account: 'current-account' } : { error: error('AUTH_REQUIRED') },
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
      read: async () => ({ error: failure }),
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
      read: async () => ({ error: initial }),
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

test('Realm confirms an anonymous browser with one read and no refresh', async () => {
  const failure = error('AUTH_REQUIRED');
  let reads = 0;
  const read = createBrowserSessionReader({
    read: async () => {
      reads += 1;
      return { error: failure, noRefreshCookie: true };
    },
    renew: async () => assert.fail('An anonymous browser cannot refresh'),
    exclusive: async () => assert.fail('An anonymous browser does not need the lock'),
  });
  await assert.rejects(read(), (value) => value === failure);
  assert.equal(reads, 1);
});
