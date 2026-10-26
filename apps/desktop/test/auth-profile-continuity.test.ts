import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import type { AppStoreState, RuntimeAccountAuthProjection } from '../src/shell/renderer/app-shell/providers/store-types.js';
import { createDesktopAccountProfileHydrator } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-account-profile.js';
import { projectRuntimeAccountAuthState } from '../src/shell/renderer/infra/bootstrap/runtime-account-state-machine.js';

function seededStore(status: AppStoreState['auth']['status'] = 'authenticated') {
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  store.setState({ auth: { status, sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'revision-1',
    user: { id: 'account-a', realmEnvironmentId: 'realm-a', displayName: 'Realm A', email: 'a@example.test', avatarUrl: '/a.png' } } });
  return store;
}

function projection(overrides: Partial<RuntimeAccountAuthProjection> = {}): RuntimeAccountAuthProjection {
  return { status: 'authenticated', sequence: '2', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'revision-1',
    user: { id: 'account-a', realmEnvironmentId: 'realm-a', displayName: 'Runtime A' }, ...overrides };
}

for (const from of ['authenticated', 'refresh-pending'] as const) {
  for (const to of ['authenticated', 'refresh-pending'] as const) {
    test(`${from} to ${to} with the same authority keeps profile fields and takes fresh Runtime facts`, () => {
      const store = seededStore(from);
      store.getState().applyRuntimeAccountProjection(projection({ status: to, reasonCode: 7, accountReasonCode: 8 }));
      const auth = store.getState().auth;
      assert.equal(auth.status, to);
      assert.equal(auth.sequence, '2');
      assert.equal(auth.reasonCode, 7);
      assert.equal(auth.accountReasonCode, 8);
      assert.equal(auth.authorizationRevision, 'revision-1');
      assert.deepEqual(auth.user, { id: 'account-a', realmEnvironmentId: 'realm-a', displayName: 'Runtime A', email: 'a@example.test', avatarUrl: '/a.png' });
    });
  }
}

for (const change of ['authorization', 'account', 'realm', 'missing-authorization', 'missing-account', 'missing-realm', 'anonymous', 'unavailable'] as const) {
  test(`a ${change} change does not retain the prior profile`, () => {
    const store = seededStore();
    let next = projection();
    if (change === 'authorization') next = projection({ authorizationRevision: 'revision-2' });
    if (change === 'account') next = projection({ user: { ...next.user, id: 'account-b' } });
    if (change === 'realm') next = projection({ user: { ...next.user, realmEnvironmentId: 'realm-b' } });
    if (change === 'missing-authorization') next = projection({ authorizationRevision: '' });
    if (change === 'missing-account') next = projection({ user: { realmEnvironmentId: 'realm-a' } });
    if (change === 'missing-realm') next = projection({ user: { id: 'account-a' } });
    if (change === 'anonymous' || change === 'unavailable') next = projection({ status: change, user: null, authorizationRevision: '' });
    store.getState().applyRuntimeAccountProjection(next);
    assert.deepEqual(store.getState().auth.user, next.user);
    assert.equal(store.getState().auth.user?.email, undefined);
    assert.equal(store.getState().auth.user?.avatarUrl, undefined);
  });
}

for (const status of ['anonymous', 'unavailable', 'logging-out'] as const) {
  test(`a prior ${status} projection cannot lend its profile to new authenticated state`, () => {
    const store = seededStore(status);
    store.getState().applyRuntimeAccountProjection(projection());
    assert.equal(store.getState().auth.user?.email, undefined);
    assert.equal(store.getState().auth.user?.avatarUrl, undefined);
  });
}

test('hydration followed by the real Runtime snapshot projector retains the recovered profile in the real store', async () => {
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  const status = { state: 'authenticated' as const, sequence: '1', reasonCode: 0, accountReasonCode: 0,
    authorizationRevision: 'revision-1', accountProjection: { accountId: 'account-a', realmEnvironmentId: 'realm-a', displayName: 'Runtime A' } };
  store.getState().applyRuntimeAccountProjection(projectRuntimeAccountAuthState(status, null));
  const clientScope = {};
  const hydrator = createDesktopAccountProfileHydrator({
    flowId: 'hydrate-then-snapshot',
    lifecycle: { auth: () => store.getState().auth, setAuthSession: user => store.getState().setAuthSession(user) },
    readClientScope: () => clientScope,
    isCurrentBootstrap: () => true,
    loadCurrentUser: async () => ({ id: 'account-a', displayName: 'Realm A', email: 'a@example.test', avatarUrl: '/a.png' }),
    logEvent: () => {},
  });
  await hydrator.hydrate();
  store.getState().applyRuntimeAccountProjection(projectRuntimeAccountAuthState({ ...status, sequence: '2' }, store.getState().auth.user));
  assert.equal(store.getState().auth.user?.email, 'a@example.test');
  assert.equal(store.getState().auth.user?.avatarUrl, '/a.png');
  assert.equal(store.getState().auth.user?.id, 'account-a');
  assert.equal(store.getState().auth.user?.realmEnvironmentId, 'realm-a');
  assert.equal(store.getState().auth.authorizationRevision, 'revision-1');
  store.getState().applyRuntimeAccountProjection(projectRuntimeAccountAuthState({ ...status, sequence: '3', authorizationRevision: 'revision-2' }, store.getState().auth.user));
  assert.equal(store.getState().auth.user?.email, undefined);
  assert.equal(store.getState().auth.user?.avatarUrl, undefined);
  hydrator.dispose();
});
