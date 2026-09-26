import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDesktopInstalledAppHost } from '../src-electron/installed-app-host.js';
import type { NimiElectronInstalledAppControl } from '@nimiplatform/kit/shell/electron/main';
import type { InstalledAppRun } from '../src/shell/shared/installed-app-types.js';
import type { DesktopExecutorObservation } from '../src-electron/execution-notices-host.js';

test('installed Host detects an idle executor exit without a renderer list request', async () => {
  let running = true;
  let launches = 0;
  let observedExit!: () => void;
  const exited = new Promise<void>(resolve => { observedExit = resolve; });
  const control: NimiElectronInstalledAppControl = {
    launch: async () => { launches++; return { launchId: '11'.repeat(32), processId: 123, appId: 'example.app', version: '1' }; },
    status: async () => ({ running, exitCode: running ? null : 17 }),
    access: async () => ({ available: true, reasonCode: 'ACTION_EXECUTED', executionScopeRef: `execution_scope_${'A'.repeat(43)}` }),
    focus: async () => undefined, stop: async () => { running = false; }, end: async () => undefined,
    completeUninstall: async () => undefined,
  };
  const host = createDesktopInstalledAppHost(control, undefined, value => {
    if (value.state === 'stopped') { assert.equal(value.displayName, 'example.app'); observedExit(); }
  });
  await host.launchSelector(Uint8Array.from([1, 2, 3]));
  running = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('idle executor exit not observed')), 4000); })]);
    assert.equal(launches, 1, 'technical observation never launches an App');
  } finally { if (timeout) clearTimeout(timeout); await host.shutdown(); }
});

test('installed host keeps exact process, focus, stop and Access independent', async () => {
  const selector = [...new TextEncoder().encode('opaque-committed-selector')];
  let launches = 0;
  let focuses = 0;
  let focusFails = false;
  let running = false;
  let access = false;
  let accessPending = false;
  let resolveAccess: ((value: { available: boolean; reasonCode: string; executionScopeRef: string }) => void) | undefined;
  const control: NimiElectronInstalledAppControl = {
    async launch(bytes) { assert.deepEqual([...bytes], selector); launches += 1; running = true; return { launchId: '11'.repeat(32), processId: 123, appId: 'example', version: '1.0.0' }; },
    async status() { return { running, exitCode: running ? null : 0 }; },
    async focus() { focuses += 1; if (focusFails) throw new Error('activation declined'); },
    async stop() { running = false; },
    async end() { assert.equal(running, false); },
    async completeUninstall() { assert.equal(running, false); },
    async access() {
      if (accessPending) return new Promise((resolve) => { resolveAccess = resolve; });
      return { available: access, reasonCode: access ? 'ACTION_EXECUTED' : 'LOCAL_APP_SESSION_REVOKED', executionScopeRef: access ? `execution_scope_${'A'.repeat(43)}` : '' };
    },
  };
  const host = createDesktopInstalledAppHost(control);
  const call = (command: string, payload = { payload: { launchSelector: selector } }) => host.commandHandlers[command]!({ payload });
  let run = await call('installed_app_launch') as InstalledAppRun;
  assert.equal(run.state, 'running');
  assert.equal(run.accessAvailable, false);
  assert.equal('launchId' in run, false);
  assert.equal('processId' in run, false);
  assert.equal('executablePath' in run, false);
  assert.equal('executionScopeRef' in run, false);
  await call('installed_app_launch');
  assert.equal(launches, 1);
  assert.equal(focuses, 1);
  access = true;
  const projectedRuns = await call('installed_app_runs_list') as InstalledAppRun[];
  assert.equal(projectedRuns.length, 1);
  assert.ok(projectedRuns[0]);
  run = projectedRuns[0];
  assert.equal(run.accessAvailable, true);
  for (const retryCommand of ['installed_app_launch', 'installed_app_focus']) {
    focusFails = true;
    run = await call('installed_app_launch') as InstalledAppRun;
    assert.equal(run.state, 'running');
    assert.equal(run.accessAvailable, true);
    assert.ok(run.message);
    assert.ok(run.reasonCode);
    focusFails = false;
    run = await call(retryCommand) as InstalledAppRun;
    assert.equal(run.message, '', 'successful activation clears the previous action failure');
    assert.equal(run.reasonCode, undefined);
    assert.equal(run.state, 'running');
    assert.equal(run.accessAvailable, true);
    assert.equal(launches, 1, 'focus recovery keeps the existing App process');
  }
  accessPending = true;
  const stalePoll = call('installed_app_runs_list');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(resolveAccess);
  run = await call('installed_app_stop') as InstalledAppRun;
  assert.equal(run.state, 'stopped');
  assert.equal(run.accessAvailable, false);
  resolveAccess({ available: true, reasonCode: 'ACTION_EXECUTED', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  const afterStop = await stalePoll as InstalledAppRun[];
  assert.equal(afterStop[0]?.state, 'stopped');
  assert.equal(afterStop[0]?.accessAvailable, false);
  await assert.rejects(() => host.commandHandlers.installed_app_launch!({ payload: { payload: { launchSelector: selector, executablePath: 'caller.exe' } } }));
  assert.equal(launches, 1);
  await host.shutdown();
});

test('installed Host scopes stay private and unknown reads do not claim revocation', async () => {
  const observations: DesktopExecutorObservation[] = [];
  let scope = 'A'; let unknown = false;
  const host = createDesktopInstalledAppHost({
    launch: async () => ({ launchId: '11'.repeat(32), processId: 123, appId: 'example', version: '1' }),
    status: async () => ({ running: true, exitCode: null }),
    access: async () => unknown ? { available: false, reasonCode: 'LOCAL_APP_OWNER_UNAVAILABLE', executionScopeRef: '' }
      : { available: true, reasonCode: 'ACTION_EXECUTED', executionScopeRef: `execution_scope_${scope.repeat(43)}` },
    focus: async () => undefined, stop: async () => undefined, end: async () => undefined, completeUninstall: async () => undefined,
  }, undefined, value => observations.push(value));
  try {
    await host.launchSelector(Uint8Array.from([5]));
    unknown = true;
    await host.commandHandlers.installed_app_runs_list!({ payload: {} });
    unknown = false; scope = 'B';
    const projected = await host.commandHandlers.installed_app_runs_list!({ payload: {} });
    assert.deepEqual(observations.map(row => row.state), ['running', 'scope-unknown', 'running']);
    assert.equal(observations[2]?.executionScopeRef, `execution_scope_${'B'.repeat(43)}`);
    assert.equal(JSON.stringify(projected).includes('execution_scope_'), false);
  } finally { await host.shutdown(); }
});

test('installed host preserves an abnormal exit across later polls and resets it on relaunch', async () => {
  let running = false;
  let tracked = false;
  let statuses = 0;
  const control: NimiElectronInstalledAppControl = {
    async launch() { running = true; tracked = true; return { launchId: '22'.repeat(32), processId: 234, appId: 'example', version: '1.0.0' }; },
    async status() { statuses += 1; return { running, exitCode: tracked && !running ? 17 : null }; },
    async focus() {},
    async stop() { running = false; tracked = false; },
    async end() {},
    async completeUninstall() {},
    async access() { return { available: false, reasonCode: 'LOCAL_APP_SESSION_REVOKED', executionScopeRef: '' }; },
  };
  const host = createDesktopInstalledAppHost(control);
  const payload = { payload: { launchSelector: [1] } };
  await host.commandHandlers.installed_app_launch!({ payload });
  running = false;
  const first = await host.commandHandlers.installed_app_runs_list!({ payload: {} }) as InstalledAppRun[];
  assert.equal(first[0]?.state, 'crashed');
  const readsAtExit = statuses;
  const next = await host.commandHandlers.installed_app_runs_list!({ payload: {} }) as InstalledAppRun[];
  assert.equal(next[0]?.state, 'crashed');
  assert.equal(statuses, readsAtExit);
  const restarted = await host.commandHandlers.installed_app_launch!({ payload }) as InstalledAppRun;
  assert.equal(restarted.state, 'running');
  await host.shutdown();
});

for (const retryVia of ['poll', 'launch', 'shutdown'] as const) {
  test(`installed host retains a failed end lease for retry through ${retryVia}`, async () => {
    let running = false;
    let tracked = false;
    let lease: string | null = null;
    let launches = 0;
    let endFailures = 1;
    let statuses = 0;
    const ended: string[] = [];
    const control: NimiElectronInstalledAppControl = {
      async launch() {
        if (lease) throw new Error('LOCAL_APP_LAUNCH_LEASE_REPLAY');
        lease = String(++launches).padStart(64, '0');
        running = true; tracked = true;
        return { launchId: lease, processId: 123, appId: 'example', version: '1.0.0' };
      },
      async status() { statuses += 1; return { running, exitCode: tracked && !running ? 17 : null }; },
      async stop() { running = false; tracked = false; },
      async end(id) {
        ended.push(id);
        if (endFailures-- > 0) throw new Error('temporary end failure');
        assert.equal(id, lease);
        lease = null;
      },
      async focus() {},
      async access() { return { available: false, reasonCode: 'LOCAL_APP_SESSION_REVOKED', executionScopeRef: '' }; },
      async completeUninstall() {},
    };
    const host = createDesktopInstalledAppHost(control);
    const payload = { payload: { launchSelector: [1] } };
    await host.commandHandlers.installed_app_launch!({ payload });
    const firstLease = lease;
    running = false;
    let rows = await host.commandHandlers.installed_app_runs_list!({ payload: {} }) as InstalledAppRun[];
    assert.equal(rows[0]?.state, 'crashed');
    assert.equal(lease, firstLease);
    const readsAfterExit = statuses;
    if (retryVia === 'poll') {
      rows = await host.commandHandlers.installed_app_runs_list!({ payload: {} }) as InstalledAppRun[];
      assert.equal(rows[0]?.state, 'crashed');
      assert.equal(statuses, readsAfterExit, 'terminal cleanup does not re-read a cleared native process');
      assert.equal(lease, null);
    }
    if (retryVia === 'shutdown') {
      await host.shutdown();
      host.resume();
      assert.equal(lease, null);
    }
    const restarted = await host.commandHandlers.installed_app_launch!({ payload }) as InstalledAppRun;
    assert.equal(restarted.state, 'running');
    assert.equal(launches, 2);
    assert.deepEqual(ended.slice(0, 2), [firstLease, firstLease]);
    await host.shutdown();
  });
}

test('relaunch keeps its captured lease while an overlapping poll completes cleanup', async () => {
  let running = false;
  let lease: string | null = null;
  let launches = 0;
  let stopCalls = 0;
  let endCalls = 0;
  let releaseEnd!: () => void;
  let releaseStop!: () => void;
  const endPending = new Promise<void>((resolve) => { releaseEnd = resolve; });
  const stopPending = new Promise<void>((resolve) => { releaseStop = resolve; });
  const control: NimiElectronInstalledAppControl = {
    async launch() {
      assert.equal(lease, null);
      lease = String(++launches).padStart(64, '0'); running = true;
      return { launchId: lease, processId: 123, appId: 'example', version: '1.0.0' };
    },
    async status() { return { running, exitCode: running ? null : 17 }; },
    async stop() { running = false; if (++stopCalls === 2) await stopPending; },
    async end(id) {
      assert.equal(typeof id, 'string');
      if (++endCalls === 1) await endPending;
      if (id === lease) lease = null;
    },
    async focus() {},
    async access() { return { available: false, reasonCode: 'LOCAL_APP_SESSION_REVOKED', executionScopeRef: '' }; },
    async completeUninstall() {},
  };
  const host = createDesktopInstalledAppHost(control);
  const payload = { payload: { launchSelector: [1] } };
  await host.commandHandlers.installed_app_launch!({ payload });
  running = false;
  const poll = host.commandHandlers.installed_app_runs_list!({ payload: {} });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const restart = host.commandHandlers.installed_app_launch!({ payload });
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseEnd();
  await poll;
  releaseStop();
  assert.equal((await restart as InstalledAppRun).state, 'running');
  assert.equal(launches, 2);
  await host.shutdown();
});

test('installed launches share the data-root gate and a queued launch never outlives a handoff stop', async () => {
  const { createDesktopDataRootOperationGate } = await import('../src-electron/data-root-operation-gate.js');
  const selector = [...new TextEncoder().encode('opaque-committed-selector')];
  let launches = 0;
  let running = false;
  const control: NimiElectronInstalledAppControl = {
    async launch() { launches += 1; running = true; return { launchId: '11'.repeat(32), processId: 123, appId: 'example', version: '1.0.0' }; },
    async status() { return { running, exitCode: running ? null : 0 }; },
    async focus() {},
    async stop() { running = false; },
    async end() {},
    async completeUninstall() {},
    async access() { return { available: false, reasonCode: 'LOCAL_APP_SESSION_REVOKED', executionScopeRef: '' }; },
  };
  const gate = createDesktopDataRootOperationGate();
  const host = createDesktopInstalledAppHost(control, gate);
  const call = (command: string) => host.commandHandlers[command]!({ payload: { payload: { launchSelector: selector } } });
  let release!: () => void;
  // A root handoff holds the gate and stops the owner before the queued launch runs.
  const handoff = gate.runExclusive(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    await host.shutdown();
  });
  const queued = call('installed_app_launch') as Promise<InstalledAppRun>;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await host.hasActiveRuns(), true, 'a queued launch is an active managed start');
  release();
  await handoff;
  const refused = await queued;
  assert.equal(refused.state, 'crashed');
  assert.equal(refused.reasonCode, 'installed-app-launch-failed');
  assert.equal(launches, 0, 'the owner closed before the queued launch was admitted');

  host.resume();
  const launched = await call('installed_app_launch') as InstalledAppRun;
  assert.equal(launched.state, 'running');
  assert.equal(launches, 1);
  assert.equal(await host.hasActiveRuns(), true);
  await host.shutdown();
  assert.equal(await host.hasActiveRuns(), false);
});
