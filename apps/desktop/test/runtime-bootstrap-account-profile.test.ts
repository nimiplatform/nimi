import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAccountProfileHydrator } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-account-profile.js';
import type { DesktopRendererLifecyclePort } from '../src/shell/renderer/renderer/lifecycle-port.js';

type Auth = ReturnType<DesktopRendererLifecyclePort['auth']>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(loadCurrentUser: () => Promise<unknown>) {
  let auth: Auth = { status: 'authenticated', user: { id: 'account-a', realmEnvironmentId: 'realm-a', displayName: 'Runtime A', kept: true },
    sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'revision-1' };
  let clientScope: object | null = {};
  let currentBootstrap = true;
  let reads = 0;
  const commits: Array<Record<string, unknown> | null> = [];
  const events: string[] = [];
  const hydrator = createDesktopAccountProfileHydrator({
    flowId: 'profile-test',
    lifecycle: {
      auth: () => auth,
      setAuthSession: user => { commits.push(user); auth = { ...auth, user }; },
    },
    readClientScope: () => clientScope,
    isCurrentBootstrap: () => currentBootstrap,
    loadCurrentUser: () => { reads++; return loadCurrentUser(); },
    logEvent: event => { events.push(event.message); },
    timeoutMs: 50,
  });
  return {
    hydrator, commits, events, reads: () => reads, auth: () => auth,
    setAuth: (next: Partial<Auth>) => { auth = { ...auth, ...next }; },
    setClient: (next: object | null) => { clientScope = next; },
    retireBootstrap: () => { currentBootstrap = false; },
  };
}

test('current profile hydration is coalesced and preserves the Runtime identity and authorization', async () => {
  const reply = deferred<unknown>();
  const f = fixture(() => reply.promise);
  const first = f.hydrator.hydrate();
  assert.equal(f.hydrator.hydrate(), first);
  await Promise.resolve();
  assert.equal(f.reads(), 1);
  reply.resolve({ id: 'account-a', displayName: 'Realm A', email: 'a@example.test', realmEnvironmentId: 'profile-is-not-environment-authority' });
  await first;
  assert.deepEqual(f.commits, [{ id: 'account-a', accountId: 'account-a', realmEnvironmentId: 'realm-a', displayName: 'Realm A', email: 'a@example.test', kept: true }]);
  assert.equal(f.auth().authorizationRevision, 'revision-1');
  assert.deepEqual(f.events, ['phase:account-profile:hydrated']);
});

test('an unavailable initial read stays non-critical and a later recovery refresh can hydrate', async () => {
  let unavailable = true;
  const f = fixture(async () => {
    if (unavailable) throw new Error('Realm temporarily unavailable');
    return { id: 'account-a', displayName: 'Recovered A' };
  });
  await f.hydrator.hydrate();
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.events, ['phase:account-profile:hydrate-deferred']);
  unavailable = false;
  await f.hydrator.hydrate();
  assert.equal(f.reads(), 2);
  assert.equal(f.commits[0]?.displayName, 'Recovered A');
});

for (const change of ['anonymous', 'refresh-pending', 'account', 'realm', 'authorization', 'client', 'bootstrap', 'dispose'] as const) {
  test(`late profile is not committed after ${change} changes`, async () => {
    const reply = deferred<unknown>();
    const f = fixture(() => reply.promise);
    const pending = f.hydrator.hydrate();
    await Promise.resolve();
    switch (change) {
      case 'anonymous': f.setAuth({ status: 'anonymous' }); break;
      case 'refresh-pending': f.setAuth({ status: 'refresh-pending' }); break;
      case 'account': f.setAuth({ user: { ...f.auth().user, id: 'account-b' } }); break;
      case 'realm': f.setAuth({ user: { ...f.auth().user, realmEnvironmentId: 'realm-b' } }); break;
      case 'authorization': f.setAuth({ authorizationRevision: 'revision-2' }); break;
      case 'client': f.setClient({}); break;
      case 'bootstrap': f.retireBootstrap(); break;
      case 'dispose': f.hydrator.dispose(); break;
    }
    reply.resolve({ id: 'account-a', displayName: 'Obsolete A' });
    await pending;
    assert.deepEqual(f.commits, []);
    assert.deepEqual(f.events, []);
  });
}

test('a newer account refresh can finish while the previous account read is still pending', async () => {
  const oldReply = deferred<unknown>();
  const newReply = deferred<unknown>();
  let request = 0;
  const f = fixture(() => (++request === 1 ? oldReply.promise : newReply.promise));
  const old = f.hydrator.hydrate();
  await Promise.resolve();
  f.setAuth({ user: { id: 'account-b', realmEnvironmentId: 'realm-b' }, authorizationRevision: 'revision-2' });
  const current = f.hydrator.hydrate();
  newReply.resolve({ id: 'account-b', displayName: 'Current B' });
  await current;
  oldReply.resolve({ id: 'account-a', displayName: 'Late A' });
  await old;
  assert.equal(f.commits.length, 1);
  assert.equal(f.auth().user?.id, 'account-b');
  assert.equal(f.auth().user?.displayName, 'Current B');
});

test('timeout retires the commit continuation even if the underlying read resolves after a fresh retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldReply = deferred<unknown>();
  let request = 0;
  const f = fixture(() => (++request === 1 ? oldReply.promise : Promise.resolve({ id: 'account-a', displayName: 'Fresh A' })));
  const pending = f.hydrator.hydrate();
  await Promise.resolve();
  t.mock.timers.tick(51);
  await pending;
  assert.deepEqual(f.commits, []);
  assert.deepEqual(f.events, ['phase:account-profile:hydrate-deferred']);
  await f.hydrator.hydrate();
  oldReply.resolve({ id: 'account-a', displayName: 'Timed-out A' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.commits.length, 1);
  assert.equal(f.auth().user?.displayName, 'Fresh A');
});

test('a wrong-account Realm response is never merged into the current Runtime projection', async () => {
  const f = fixture(async () => ({ id: 'account-b', displayName: 'Other account' }));
  await f.hydrator.hydrate();
  assert.deepEqual(f.commits, []);
  assert.equal(f.auth().user?.id, 'account-a');
  assert.deepEqual(f.events, ['phase:account-profile:hydrate-deferred']);
});

test('unproven identity, missing client and disposal before dispatch do not start a read', async () => {
  for (const missing of ['authentication', 'account', 'realm', 'authorization', 'client', 'disposed'] as const) {
    const f = fixture(async () => ({ id: 'account-a' }));
    if (missing === 'authentication') f.setAuth({ status: 'unavailable' });
    if (missing === 'account') f.setAuth({ user: null });
    if (missing === 'realm') f.setAuth({ user: { id: 'account-a' } });
    if (missing === 'authorization') f.setAuth({ authorizationRevision: '' });
    if (missing === 'client') f.setClient(null);
    const pending = f.hydrator.hydrate();
    if (missing === 'disposed') f.hydrator.dispose();
    await pending;
    assert.equal(f.reads(), 0, missing);
    assert.deepEqual(f.commits, []);
  }
});
