import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import type { RuntimeAccountAuthProjection } from '../src/shell/renderer/app-shell/providers/store-types.js';

function store() {
  return createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
}

function projection(status: RuntimeAccountAuthProjection['status'], accountId?: string): RuntimeAccountAuthProjection {
  return { status, sequence: '1', reasonCode: 0, accountReasonCode: 0, user: accountId ? { id: accountId } : null };
}

function openPartner(app: ReturnType<typeof store>) {
  app.setState((state) => ({
    selectedTargetBySource: { ...state.selectedTargetBySource, agent: 'agent:ren' },
    lastSelectedThreadByMode: { ...state.lastSelectedThreadByMode, agent: 'thread-7' },
  }));
}

test('an unproven account hides the open partner and brings it back for the same account', () => {
  const app = store();
  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  openPartner(app);

  app.getState().applyRuntimeAccountProjection(projection('unavailable'));
  app.getState().applyRuntimeAccountProjection(projection('unavailable'));
  assert.equal(app.getState().selectedTargetBySource.agent, null, 'hidden while identity is unproven');
  assert.equal(app.getState().lastSelectedThreadByMode.agent, null);

  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  assert.equal(app.getState().selectedTargetBySource.agent, 'agent:ren');
  assert.equal(app.getState().lastSelectedThreadByMode.agent, 'thread-7');
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
    assert.equal(app.getState().selectedTargetBySource.agent, null, next.status);
  }
  const app = store();
  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  openPartner(app);
  app.getState().applyRuntimeAccountProjection(projection('unavailable'));
  app.getState().clearAuthSession();
  app.getState().applyRuntimeAccountProjection(projection('authenticated', 'account-a'));
  assert.equal(app.getState().selectedTargetBySource.agent, null, 'sign-out drops it');
});
