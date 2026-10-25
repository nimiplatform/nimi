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

function openPartner(app: ReturnType<typeof store>) {
  const agentHandle = `agent_ref_${'a'.repeat(43)}`;
  app.getState().setAgentConversationTargetSnapshot({ agentHandle, conversationAnchorId: 'anchor-a', displayName: 'Partner', handle: '', avatarUrl: null, worldId: null, worldName: null, bio: null, ownershipType: null, greeting: null, builtinDocsContext: null });
  void app.navigation.push({ id: 'chat', chat: { mode: 'agent', agentHandle, conversationAnchorId: 'anchor-a', targetId: agentHandle } });
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

test('an unproven account clears page history and retains proven business references only for the same account', () => {
  const app = store();
  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  openPartner(app);

  app.getState().applyRuntimeAccountProjection(projection('unavailable'));
  app.getState().applyRuntimeAccountProjection(projection('unavailable'));
  assert.equal(app.navigation.getSnapshot().current.destination.id, 'home');
  assert.equal(app.navigation.getSnapshot().canGoBack, false);
  assert.equal(app.getState().lastSelectedThreadByMode.agent, null);

  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  assert.equal(app.navigation.getSnapshot().current.destination.id, 'home');
  assert.equal(Object.values(app.getState().agentConversationTargetByHandle)[0]?.conversationAnchorId, 'anchor-a');
  assert.equal(app.getState().suspendedAgentSelection, null);
});

test('another account, a sign-out or an account switch never receives the suspended selection', () => {
  for (const next of [projection('authenticated', 'account-b'), projection('anonymous'), projection('switching')]) {
    const app = store();
    app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
    openPartner(app);
    app.getState().applyRuntimeAccountProjection(projection('unavailable'));
    app.getState().applyRuntimeAccountProjection(next);
    app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
    assert.equal(app.navigation.getSnapshot().current.destination.id, 'home', next.status);
    assert.deepEqual(app.getState().agentConversationTargetByHandle, {}, next.status);
  }
  const app = store();
  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  openPartner(app);
  app.getState().applyRuntimeAccountProjection(projection('unavailable'));
  app.getState().clearAuthSession();
  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  assert.equal(app.navigation.getSnapshot().current.destination.id, 'home', 'sign-out clears the page');
  assert.deepEqual(app.getState().agentConversationTargetByHandle, {}, 'sign-out drops the references');
});
