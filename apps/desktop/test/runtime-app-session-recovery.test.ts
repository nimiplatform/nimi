import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { DesktopRendererLifecyclePort } from '../src/shell/renderer/renderer/lifecycle-port.js';
import { recoverRuntimeAppSession } from '../src/shell/renderer/infra/bootstrap/runtime-app-session-recovery.js';
import * as accountState from '../src/shell/renderer/infra/bootstrap/runtime-account-state-machine.js';
import { QueryClient } from '@tanstack/react-query';

function fixture() {
  let auth: ReturnType<DesktopRendererLifecyclePort['auth']> = {
    status: 'authenticated', user: { id: 'account-a', realmEnvironmentId: 'realm' },
    sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'authorization-a',
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

type AccountTestSnapshot = {
  state: 'authenticated' | 'refresh-pending' | 'expired' | 'anonymous' | 'switching';
  sequence: string;
  authorizationRevision: string;
  reasonCode: number;
  accountReasonCode: number;
  accountProjection: { accountId: string; realmEnvironmentId: string; displayName: string };
};

function watcherFixture(initial: Partial<AccountTestSnapshot> = {}) {
  const f = fixture();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const anchors = new Map<string, string>();
  const diagnostics: { details?: Record<string, unknown> }[] = [];
  let snapshot: AccountTestSnapshot = { state: 'authenticated', sequence: '1', authorizationRevision: 'authorization-a',
    reasonCode: 0, accountReasonCode: 0,
    accountProjection: { accountId: 'account-a', realmEnvironmentId: 'realm', displayName: 'A' }, ...initial };
  let handlers!: { onEvent(event: unknown): void; onError(error: unknown): void; onCompleted(): void };
  let probes = 0;
  let probe: () => Promise<{ sessionBound: boolean; reasonCode: string }> = async () => ({ sessionBound: true, reasonCode: 'action-executed' });
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const imports: Record<string, unknown> = {
    '../../bridge': { desktopBridge: {
      getRuntimeAccountSessionStatus: async () => snapshot,
      subscribeRuntimeAccountSessionEvents: async (_after: string, next: typeof handlers) => { handlers = next; return () => {}; },
    } },
    '../offline/coordinator': { getOfflineCoordinator: () => ({ markRuntimeReachability() {}, markRealmRestReachability() {} }) },
    '@nimiplatform/kit/telemetry': { logRendererEvent: (entry: typeof diagnostics[number]) => diagnostics.push(entry) },
    '../sdk/desktop-nimi-client-session.js': { getDesktopFormalAppClient: () => ({ auth: { status: () => { probes++; return probe(); } } }) },
    './runtime-app-session-recovery.js': { recoverRuntimeAppSession },
    './runtime-account-state-machine': accountState,
  };
  const source = readFileSync(new URL('../src/shell/renderer/infra/bootstrap/auth-state-watcher.ts', import.meta.url), 'utf8');
  const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const watcher = {} as {
    startAuthStateWatcher(port: unknown): void; stopAuthStateWatcher(): void; retryRuntimeAccountConnectionNow(): void;
  };
  // Real watcher and recovery, with transport and the retry scheduler controlled
  // by this regression. These events are not product acceptance evidence.
  new Function('require', 'exports', 'setTimeout', 'clearTimeout', emitted)(
    (name: string) => { assert.ok(name in imports, `unexpected dependency: ${name}`); return imports[name]; }, watcher,
    (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; },
    (id: number) => timers.delete(id),
  );
  const lifecycle = { ...f.lifecycle, applyRuntimeAccountProjection: f.changeAuth,
    clearAgentConversationAnchorBindings() { f.lifecycle.clearAgentConversationAnchorBindings(); anchors.clear(); },
    async invalidateQueries(keys: readonly (readonly unknown[])[]) {
      await f.lifecycle.invalidateQueries(keys);
      await Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey })));
    },
    async cancelAndClearQueries() { f.events.push('clear-queries'); await queryClient.cancelQueries(); queryClient.clear(); },
    setStatusBanner() {}, translate: (key: string) => key,
  };
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  return { ...f, queryClient, anchors, diagnostics, settle, lifecycle,
    get probes() { return probes; },
    setProbe(next: typeof probe) { probe = next; },
    async start() { watcher.startAuthStateWatcher(lifecycle); await settle(); },
    async snapshotEvent() { handlers.onEvent({ ...snapshot, deliveryKind: 'snapshot' }); await settle(); },
    async emit(next: Partial<AccountTestSnapshot> = {}) {
      const state = next.state ?? snapshot.state;
      snapshot = { ...snapshot, sequence: String(Number(snapshot.sequence) + 1), ...next,
        authorizationRevision: state === 'authenticated' || state === 'refresh-pending'
          ? next.authorizationRevision ?? snapshot.authorizationRevision : '' };
      handlers.onEvent({ ...snapshot, deliveryKind: 'live' }); await settle();
    },
    async retry() { watcher.retryRuntimeAccountConnectionNow(); await settle(); },
    async loseStream() { handlers.onCompleted(); await settle(); },
    async gap() { snapshot = { ...snapshot, sequence: String(Number(snapshot.sequence) + 2) }; handlers.onEvent({ ...snapshot, deliveryKind: 'live' }); await settle(); },
    async runRetry() { const callback = timers.values().next().value; assert.ok(callback); timers.clear(); callback(); await settle(); },
    async close() { watcher.stopAuthStateWatcher(); await queryClient.cancelQueries(); queryClient.clear(); },
  };
}

test('a proven same-authorization refresh keeps Account-driven queries and Agent anchors intact', async () => {
  const f = watcherFixture();
  try {
    await f.start(); await f.snapshotEvent();
    assert.equal(f.probes, 1);
    const key = ['runtime', 'capability-inventory'];
    const cached = { status: 'existing-ready-projection' };
    f.queryClient.setQueryData(key, cached);
    f.anchors.set('agent-reference', 'conversation-anchor');
    const events = f.events.length;
    await f.emit({ state: 'refresh-pending' });
    await f.emit({ state: 'authenticated' });
    assert.equal(f.probes, 1, 'routine Account refresh must not repeat the completed technical recovery');
    assert.equal(f.events.length, events);
    assert.equal(f.queryClient.getQueryData(key), cached);
    assert.equal(f.queryClient.getQueryState(key)?.isInvalidated, false);
    assert.equal(f.anchors.get('agent-reference'), 'conversation-anchor');
    assert.ok(f.diagnostics.some(entry => entry.details?.recoveryCause === 'same-authorization-refresh'));
    assert.doesNotMatch(JSON.stringify(f.diagnostics), /authorization-a|account-a|conversation-anchor/u);
  } finally { await f.close(); }
});

test('changed authorization without an intermediate expiry event still performs complete recovery', async () => {
  for (const pendingFirst of [false, true]) {
    const f = watcherFixture();
    try {
      await f.start(); await f.snapshotEvent();
      const key = ['runtime', 'capability-inventory'];
      f.queryClient.setQueryData(key, {}); f.anchors.set('agent', 'old-anchor');
      if (pendingFirst) await f.emit({ state: 'refresh-pending' });
      await f.emit({ state: 'authenticated', authorizationRevision: 'authorization-replaced' });
      assert.equal(f.probes, 2);
      assert.equal(f.anchors.size, 0);
      assert.equal(f.queryClient.getQueryState(key)?.isInvalidated, true);
      assert.ok(f.diagnostics.some(entry => entry.details?.revisionChanged === true && entry.details?.recoveryCause === 'authorization-changed'));
      await f.emit({ state: 'refresh-pending' }); await f.emit({ state: 'authenticated' });
      assert.equal(f.probes, 2, 'a subsequently proven continuous refresh can reuse the new Account recovery');
    } finally { await f.close(); }
  }
});

test('same authorization never bypasses an explicit retry or unknown account stream recovery', async () => {
  for (const loss of ['completed', 'gap'] as const) {
    const f = watcherFixture();
    try {
      await f.start(); await f.snapshotEvent();
      await f.retry(); await f.snapshotEvent();
      assert.equal(f.probes, 2);
      assert.ok(f.diagnostics.some(entry => entry.details?.recoveryCause === 'explicit-retry'));
      if (loss === 'completed') await f.loseStream(); else await f.gap();
      assert.equal(f.lifecycle.auth().status, 'unavailable');
      assert.equal(f.lifecycle.auth().authorizationRevision, '');
      assert.ok(f.events.includes('clear-queries'));
      await f.runRetry(); await f.snapshotEvent();
      assert.equal(f.probes, 3);
      assert.ok(f.diagnostics.some(entry => entry.details?.recoveryCause === 'stream-resync'));
    } finally { await f.close(); }
  }
});

test('startup pending has no successful recovery to reuse even if it already carries the later revision', async () => {
  for (const authorizationRevision of ['', 'authorization-a']) {
    const f = watcherFixture({ state: 'refresh-pending', authorizationRevision });
    try {
      await f.start(); await f.snapshotEvent();
      assert.equal(f.probes, 0);
      await f.emit({ state: 'authenticated', authorizationRevision: 'authorization-a' });
      assert.equal(f.probes, 1);
      assert.deepEqual(f.events, ['clear-handles', ['read', [[]]]]);
    } finally { await f.close(); }
  }
});

test('restarting the watcher performs full recovery even with the same Account revision', async () => {
  const f = watcherFixture();
  try {
    await f.start(); await f.snapshotEvent();
    await f.close();
    await f.start(); await f.snapshotEvent();
    assert.equal(f.probes, 2);
    await f.emit({ state: 'refresh-pending' }); await f.emit({ state: 'authenticated' });
    assert.equal(f.probes, 2);
  } finally { await f.close(); }
});

test('a failed forced retry cannot reuse an older successful Account recovery', async () => {
  const f = watcherFixture();
  try {
    await f.start(); await f.snapshotEvent();
    f.setProbe(async () => { throw new Error('session-invalid'); });
    await f.retry(); await f.snapshotEvent();
    assert.equal(f.probes, 2);
    assert.equal(f.events.filter(event => event === 'clear-handles').length, 1);
    f.setProbe(async () => ({ sessionBound: true, reasonCode: 'action-executed' }));
    await f.emit({ state: 'refresh-pending' }); await f.emit({ state: 'authenticated' });
    assert.equal(f.probes, 3, 'the failed forced recovery retired its earlier success baseline');
    assert.equal(f.events.filter(event => event === 'clear-handles').length, 2);
  } finally { await f.close(); }
});

test('late initial readiness cannot certify a later refresh or overwrite its successful baseline', async () => {
  const f = watcherFixture();
  const complete: ((value: { sessionBound: boolean; reasonCode: string }) => void)[] = [];
  f.setProbe(() => new Promise(resolve => complete.push(resolve)));
  try {
    await f.start(); await f.snapshotEvent();
    await f.emit({ state: 'refresh-pending' }); await f.emit({ state: 'authenticated' });
    assert.equal(f.probes, 2, 'the incomplete initial probe is not reusable');
    complete[1]!({ sessionBound: true, reasonCode: 'action-executed' }); await f.settle();
    const completedEvents = f.events.length;
    complete[0]!({ sessionBound: true, reasonCode: 'action-executed' }); await f.settle();
    assert.equal(f.events.length, completedEvents);
    await f.emit({ state: 'refresh-pending' }); await f.emit({ state: 'authenticated' });
    assert.equal(f.probes, 2, 'the late old probe cannot retire the newer completed recovery');
  } finally { await f.close(); }
});

test('terminal loss and principal changes require full recovery even if a supplied revision repeats', async () => {
  for (const change of ['logout', 'switch', 'realm'] as const) {
    const f = watcherFixture();
    try {
      await f.start(); await f.snapshotEvent();
      if (change === 'logout') await f.emit({ state: 'anonymous' });
      else await f.emit({ state: change === 'switch' ? 'switching' : 'refresh-pending' });
      await f.emit({ state: 'authenticated', authorizationRevision: 'authorization-a', accountProjection: {
        accountId: change === 'switch' ? 'account-b' : 'account-a', realmEnvironmentId: change === 'realm' ? 'another-realm' : 'realm', displayName: 'Current',
      } });
      assert.equal(f.probes, 2);
      assert.equal(f.events.filter(event => event === 'clear-handles').length, 2);
    } finally { await f.close(); }
  }
});

test('recovery completion is false when authorization changes during the technical probe', async () => {
  const f = fixture();
  let complete!: (value: { sessionBound: boolean; reasonCode: string }) => void;
  const pending = recoverRuntimeAppSession({ ...f, readStatus: () => new Promise(resolve => { complete = resolve; }) });
  f.changeAuth({ ...f.lifecycle.auth(), authorizationRevision: 'another-authorization' });
  complete({ sessionBound: true, reasonCode: 'action-executed' });
  assert.equal(await pending, false);
  assert.deepEqual(f.events, []);
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
  const snapshot = { state: 'authenticated', sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'authorization-a',
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
    listener({ ...snapshot, state: 'expired', authorizationRevision: '', sequence: '2', deliveryKind: 'live' });
    listener({ ...snapshot, sequence: '3', deliveryKind: 'live' });
    await new Promise(setImmediate);
    assert.equal(probes, 2, 'reauthentication must recover the protected App session');
    assert.equal(f.lifecycle.auth().status, 'authenticated');
    assert.equal(f.events.filter((event) => event === 'clear-handles').length, 2);
  } finally {
    watcher.stopAuthStateWatcher();
  }
});
