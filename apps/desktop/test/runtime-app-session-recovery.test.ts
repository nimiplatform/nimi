import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { DesktopRendererLifecyclePort } from '../src/shell/renderer/renderer/lifecycle-port.js';
import { recoverRuntimeAppSession } from '../src/shell/renderer/infra/bootstrap/runtime-app-session-recovery.js';
import * as accountState from '../src/shell/renderer/infra/bootstrap/runtime-account-state-machine.js';

function fixture() {
  let auth: ReturnType<DesktopRendererLifecyclePort['auth']> = {
    status: 'authenticated', user: { id: 'account-a', realmEnvironmentId: 'realm' },
    sequence: '1', reasonCode: 0, accountReasonCode: 0,
  };
  const events: unknown[] = [];
  let current = true;
  return {
    events,
    changeAuth(value: typeof auth) { auth = value; },
    expire() { current = false; },
    lifecycle: {
      auth: () => auth,
      clearAgentConversationAnchorBindings: () => { events.push('clear-handles'); },
      invalidateQueries: async (keys: readonly (readonly unknown[])[]) => { events.push(['read', keys]); },
    },
    isCurrent: () => current,
  };
}

test('re-login probes the formal session before refreshing failed App reads', async () => {
  const f = fixture();
  await recoverRuntimeAppSession({ ...f, readStatus: async () => {
    f.events.push('rebind-status');
    return { sessionBound: true, reasonCode: 'action-executed' };
  } });
  assert.deepEqual(f.events, ['rebind-status', 'clear-handles', ['read', [[]]]]);
});

test('a failed formal session does not erase account login or claim reads recovered', async () => {
  for (const throws of [false, true]) {
    const f = fixture();
    await assert.rejects(recoverRuntimeAppSession({ ...f, readStatus: async () => {
      if (throws) throw new Error('session-invalid');
      return { sessionBound: false, reasonCode: 'session-invalid' };
    } }), /session-invalid/);
    assert.equal(f.lifecycle.auth().status, 'authenticated');
    assert.deepEqual(f.events, []);
  }
});

test('late readiness after logout, account switch or a superseding login never refreshes old work', async () => {
  for (const change of ['logout', 'switch', 'relogin'] as const) {
    const f = fixture();
    let finish!: (value: { sessionBound: boolean; reasonCode: string }) => void;
    const pending = recoverRuntimeAppSession({ ...f, readStatus: () => new Promise((resolve) => { finish = resolve; }) });
    if (change === 'relogin') f.expire();
    else f.changeAuth({ ...f.lifecycle.auth(), status: change === 'logout' ? 'anonymous' : 'authenticated',
      user: change === 'logout' ? null : { id: 'account-b', realmEnvironmentId: 'realm' } });
    finish({ sessionBound: true, reasonCode: 'action-executed' });
    await pending;
    assert.deepEqual(f.events, []);
  }
});

test('anonymous account does not request an App rebind', async () => {
  const f = fixture();
  f.changeAuth({ ...f.lifecycle.auth(), status: 'anonymous', user: null });
  await recoverRuntimeAppSession({ ...f, readStatus: async () => { throw new Error('must not probe'); } });
  assert.deepEqual(f.events, []);
});

test('the production account watcher restores App readiness on startup and reauthentication', async () => {
  const f = fixture();
  let listener!: (event: unknown) => void;
  let probes = 0;
  const snapshot = { state: 'authenticated', sequence: '1', reasonCode: 0, accountReasonCode: 0,
    accountProjection: { accountId: 'account-a', realmEnvironmentId: 'realm', displayName: 'A' } };
  const imports: Record<string, unknown> = {
    '../../bridge': { desktopBridge: {
      getRuntimeAccountSessionStatus: async () => snapshot,
      subscribeRuntimeAccountSessionEvents: async (_: string, handlers: { onEvent: typeof listener }) => {
        listener = handlers.onEvent;
        return () => {};
      },
    } },
    '../offline/coordinator': { getOfflineCoordinator: () => ({ markRuntimeReachability() {}, markRealmRestReachability() {} }) },
    '@nimiplatform/kit/telemetry': { logRendererEvent() {} },
    '../sdk/desktop-nimi-client-session.js': { getDesktopFormalAppClient: () => ({ auth: { status: async () => {
      probes += 1;
      return { sessionBound: true, reasonCode: 'action-executed' };
    } } }) },
    './runtime-app-session-recovery.js': { recoverRuntimeAppSession },
    './runtime-account-state-machine': accountState,
  };
  // Execute the actual watcher with only its transport/store dependencies
  // replaced. This covers the missing account-event -> technical probe wiring.
  const source = readFileSync(new URL('../src/shell/renderer/infra/bootstrap/auth-state-watcher.ts', import.meta.url), 'utf8');
  const emitted = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const watcher = {} as { startAuthStateWatcher: (port: unknown) => void; stopAuthStateWatcher: () => void };
  new Function('require', 'exports', emitted)((name: string) => {
    assert.ok(name in imports, `unexpected dependency: ${name}`);
    return imports[name];
  }, watcher);
  const lifecycle = { ...f.lifecycle,
    applyRuntimeAccountProjection: f.changeAuth,
    cancelAndClearQueries: async () => {}, setStatusBanner() {}, translate: (key: string) => key,
  };
  try {
    watcher.startAuthStateWatcher(lifecycle);
    await new Promise(setImmediate);
    assert.equal(probes, 1);
    listener({ ...snapshot, deliveryKind: 'snapshot' });
    await new Promise(setImmediate);
    assert.equal(probes, 1, 'same account snapshot must not start another recovery');
    listener({ ...snapshot, state: 'expired', sequence: '2', deliveryKind: 'live' });
    listener({ ...snapshot, sequence: '3', deliveryKind: 'live' });
    await new Promise(setImmediate);
    assert.equal(probes, 2, 'reauthentication must recover the protected App session');
    assert.equal(f.lifecycle.auth().status, 'authenticated');
    assert.equal(f.events.filter((event) => event === 'clear-handles').length, 2);
  } finally {
    watcher.stopAuthStateWatcher();
  }
});
