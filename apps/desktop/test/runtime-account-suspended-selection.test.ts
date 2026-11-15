import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import type { RuntimeAccountAuthProjection } from '../src/shell/renderer/app-shell/providers/store-types.js';

function store() {
  return createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
}

function projection(status: RuntimeAccountAuthProjection['status'], accountId?: string): RuntimeAccountAuthProjection {
  return { status, sequence: '1', reasonCode: 0, accountReasonCode: 0,
    authorizationRevision: status === 'authenticated' || status === 'refresh-pending' ? 'authorization-a' : '',
    user: accountId ? { id: accountId } : null };
}

test('Account authorization continuity is projected exactly and display setters cannot mint it', () => {
  const app = store();
  const user = { id: 'account-a', realmEnvironmentId: 'realm-a' };
  app.getState().applyRuntimeAccountProjection({ ...projection('authenticated', 'account-a'), user, authorizationRevision: 'owner-revision-a' });
  assert.equal(app.getState().auth.authorizationRevision, 'owner-revision-a');
  app.getState().setAuthSession({ ...user, displayName: 'Updated profile' });
  assert.equal(app.getState().auth.authorizationRevision, 'owner-revision-a');
  app.getState().setAuthSession({ id: 'account-b', realmEnvironmentId: 'realm-a' });
  assert.equal(app.getState().auth.authorizationRevision, '');
  app.getState().applyRuntimeAccountProjection({ ...projection('refresh-pending', 'account-a'), user, authorizationRevision: 'owner-revision-a' });
  assert.equal(app.getState().auth.authorizationRevision, 'owner-revision-a');
  app.getState().setAuthBootstrapping();
  assert.equal(app.getState().auth.authorizationRevision, '');
  app.getState().applyRuntimeAccountProjection({ ...projection('authenticated', 'account-a'), user, authorizationRevision: 'owner-revision-a' });
  app.getState().clearAuthSession();
  assert.equal(app.getState().auth.authorizationRevision, '');
  app.getState().setAuthSession(user);
  assert.equal(app.getState().auth.authorizationRevision, '');
});

test('unproven or changed Account identity retires partner management navigation', async () => {
  const app = store();
  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  await app.navigation.push({ id: 'partners', partner: { localAgentRef: 'local-agent:a', settingsSection: 'appearance' } });
  app.getState().applyRuntimeAccountProjection(projection('unavailable'));
  assert.equal(app.navigation.getSnapshot().current.destination.id, 'home');
  assert.equal(app.navigation.getSnapshot().canGoBack, false);
  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-b'));
  assert.equal(app.navigation.getSnapshot().current.destination.id, 'home');
  assert.equal(app.navigation.getSnapshot().canGoBack, false);
  app.navigation.dispose();
});
