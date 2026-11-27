import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { AccountReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import type { DesktopAccountSessionEvent, DesktopAccountSessionStatus } from '../src/shell/renderer/bridge/runtime-bridge.js';
import type { DesktopRendererLifecyclePort } from '../src/shell/renderer/renderer/lifecycle-port.js';
import * as accountState from '../src/shell/renderer/infra/bootstrap/runtime-account-state-machine.js';

const observed = {
  state: 'authenticated', sequence: '18', authorizationRevision: 'authorization-a',
  reasonCode: 0, accountReasonCode: 0,
  accountProjection: { accountId: 'account-a', realmEnvironmentId: 'realm-a', displayName: 'A' },
} as DesktopAccountSessionStatus;

function watcherFixture() {
  type Handlers = { onEvent(event: DesktopAccountSessionEvent): void; onCompleted(): void };
  const streams: Array<{ after: string; handlers: Handlers; closed: boolean }> = [];
  let statusReads = 0, clears = 0, resets = 0;
  let loadStatus = async () => observed;
  let auth: ReturnType<DesktopRendererLifecyclePort['auth']> = {
    status: 'bootstrapping', sequence: '0', user: null, authorizationRevision: '', reasonCode: 0, accountReasonCode: 0,
  };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const reachabilityCalls: string[] = [];
  const imports: Record<string, unknown> = {
    '../../bridge': { desktopBridge: {
      getRuntimeAccountSessionStatus: async () => { statusReads++; return loadStatus(); },
      subscribeRuntimeAccountSessionEvents: async (after: string, handlers: Handlers) => {
        const stream = { after, handlers, closed: false };
        streams.push(stream);
        return () => { stream.closed = true; };
      },
    } },
    '../offline/coordinator': { getOfflineCoordinator: () => ({ markRuntimeReachability() {}, markRealmRestReachability(next: string) { reachabilityCalls.push(next); } }) },
    '@nimiplatform/kit/telemetry': { logRendererEvent() {} },
    './runtime-account-state-machine': accountState,
  };
  const source = readFileSync(new URL('../src/shell/renderer/infra/bootstrap/auth-state-watcher.ts', import.meta.url), 'utf8');
  const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const watcher = {} as {
    startAuthStateWatcher(port: unknown, initial?: DesktopAccountSessionStatus): void;
    stopAuthStateWatcher(): void;
    retryRuntimeAccountConnectionNow(): void;
  };
  new Function('require', 'exports', 'setTimeout', 'clearTimeout', emitted)(
    (name: string) => { assert.ok(name in imports, `unexpected dependency: ${name}`); return imports[name]; }, watcher,
    (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; },
    (id: number) => timers.delete(id),
  );
  const lifecycle = {
    auth: () => auth,
    navigation: { reset: () => { resets++; } },
    applyRuntimeAccountProjection(next: typeof auth) { auth = next; },
    async cancelAndClearQueries() { clears++; },
    setStatusBanner() {},
  };
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  return {
    streams, settle, reachabilityCalls,
    get auth() { return auth; }, get statusReads() { return statusReads; }, get clears() { return clears; }, get resets() { return resets; },
    async start(initial?: DesktopAccountSessionStatus) { watcher.startAuthStateWatcher(lifecycle, initial); await settle(); },
    retry: watcher.retryRuntimeAccountConnectionNow,
    stop: watcher.stopAuthStateWatcher,
    setLoader(next: typeof loadStatus) { loadStatus = next; },
    async retryScheduled() {
      const callback = timers.values().next().value;
      assert.ok(callback);
      timers.clear();
      callback();
      await settle();
    },
  };
}

const event = (sequence: string, deliveryKind: DesktopAccountSessionEvent['deliveryKind'],
  state: DesktopAccountSessionStatus['state'] = 'authenticated') =>
  ({ ...observed, sequence, deliveryKind, state } as DesktopAccountSessionEvent);

test('starts from the already-observed Account cursor without rediscovery and accepts ordered replay and live rotation', async () => {
  const f = watcherFixture();
  await f.start(observed);
  assert.equal(f.statusReads, 0);
  assert.deepEqual(f.streams.map(stream => stream.after), ['18']);
  const consumer = f.streams[0]!.handlers;
  consumer.onEvent(event('19', 'replay', 'refresh-pending'));
  consumer.onEvent(event('19', 'snapshot', 'refresh-pending'));
  consumer.onEvent(event('20', 'live'));
  assert.equal(f.auth.sequence, '20');
  assert.equal(f.auth.status, 'authenticated');
  assert.equal(f.auth.authorizationRevision, observed.authorizationRevision);
  assert.equal(f.clears, 0);
  f.stop();
});

test('a stream gap hides and clears account work before recovering from a fresh owner snapshot', async () => {
  const f = watcherFixture();
  await f.start(observed);
  const previous = f.streams[0]!;
  previous.handlers.onEvent(event('18', 'snapshot'));
  previous.handlers.onEvent(event('21', 'live'));
  assert.equal(f.auth.status, 'unavailable');
  assert.equal(f.clears, 1);
  assert.equal(f.resets, 1);
  assert.equal(previous.closed, true);
  previous.handlers.onEvent(event('19', 'live'));
  assert.equal(f.auth.status, 'unavailable');
  f.setLoader(async () => ({ ...observed, sequence: '21' }));
  await f.retryScheduled();
  assert.equal(f.auth.status, 'authenticated');
  assert.equal(f.statusReads, 1);
  assert.deepEqual(f.streams.map(stream => stream.after), ['18', '21']);
  f.stop();
});

test('manual retry supersedes a stalled initial owner read and installs only its current cursor', async () => {
  const f = watcherFixture();
  let finish!: (value: DesktopAccountSessionStatus) => void;
  f.setLoader(() => new Promise(resolve => { finish = resolve; }));
  await f.start();
  f.setLoader(async () => ({ ...observed, sequence: '22' }));
  f.retry();
  finish(observed);
  await f.settle();
  assert.equal(f.statusReads, 2);
  assert.equal(f.auth.sequence, '22');
  assert.deepEqual(f.streams.map(stream => stream.after), ['22']);
  f.stop();
});

test('keeps Home authenticated on REFRESH_OUTCOME_AMBIGUOUS, marks Realm unreachable, and restores reachable on reauth', async () => {
  const f = watcherFixture();
  await f.start(observed);
  const consumer = f.streams[0]!.handlers;
  consumer.onEvent(event('18', 'snapshot', 'authenticated'));
  consumer.onEvent(event('19', 'live', 'refresh-pending'));
  consumer.onEvent({
    ...event('20', 'live', 'authenticated'),
    accountReasonCode: AccountReasonCode.REFRESH_OUTCOME_AMBIGUOUS,
  });
  assert.equal(f.auth.status, 'authenticated');
  assert.equal(f.auth.user?.id, 'account-a');
  assert.equal(f.auth.authorizationRevision, observed.authorizationRevision);
  assert.equal(f.auth.accountReasonCode, AccountReasonCode.REFRESH_OUTCOME_AMBIGUOUS);
  assert.equal(f.clears, 0);
  assert.equal(f.resets, 0);
  assert.deepEqual(f.reachabilityCalls, ['unreachable']);

  consumer.onEvent({
    ...event('21', 'live', 'authenticated'),
    accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
  });
  assert.equal(f.auth.status, 'authenticated');
  assert.equal(f.auth.accountReasonCode, AccountReasonCode.ACTION_EXECUTED);
  assert.deepEqual(f.reachabilityCalls, ['unreachable', 'reachable']);
  f.stop();
});
