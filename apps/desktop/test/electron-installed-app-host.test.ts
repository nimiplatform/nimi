import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDesktopInstalledAppHost } from '../src-electron/installed-app-host.js';
import type { NimiElectronInstalledAppControl } from '@nimiplatform/kit/shell/electron/main';
import type { InstalledAppRun } from '../src/shell/shared/installed-app-types.js';

test('installed host keeps exact process, focus, stop and Access independent', async () => {
  const selector = [...new TextEncoder().encode('opaque-committed-selector')];
  let launches = 0;
  let focuses = 0;
  let running = false;
  let access = false;
  let accessPending = false;
  let resolveAccess: ((value: { available: boolean; reasonCode: string }) => void) | undefined;
  const control: NimiElectronInstalledAppControl = {
    async launch(bytes) { assert.deepEqual([...bytes], selector); launches += 1; running = true; return { launchId: '11'.repeat(32), processId: 123, appId: 'example', version: '1.0.0' }; },
    async status() { return { running, exitCode: running ? null : 0 }; },
    async focus() { focuses += 1; },
    async stop() { running = false; },
    async end() { assert.equal(running, false); },
    async completeUninstall() { assert.equal(running, false); },
    async access() {
      if (accessPending) return new Promise((resolve) => { resolveAccess = resolve; });
      return { available: access, reasonCode: access ? 'ACTION_EXECUTED' : 'LOCAL_APP_SESSION_REVOKED' };
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
  await call('installed_app_launch');
  assert.equal(launches, 1);
  assert.equal(focuses, 1);
  access = true;
  const projectedRuns = await call('installed_app_runs_list') as InstalledAppRun[];
  assert.equal(projectedRuns.length, 1);
  assert.ok(projectedRuns[0]);
  run = projectedRuns[0];
  assert.equal(run.accessAvailable, true);
  accessPending = true;
  const stalePoll = call('installed_app_runs_list');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(resolveAccess);
  run = await call('installed_app_stop') as InstalledAppRun;
  assert.equal(run.state, 'stopped');
  assert.equal(run.accessAvailable, false);
  resolveAccess({ available: true, reasonCode: 'ACTION_EXECUTED' });
  const afterStop = await stalePoll as InstalledAppRun[];
  assert.equal(afterStop[0]?.state, 'stopped');
  assert.equal(afterStop[0]?.accessAvailable, false);
  await assert.rejects(() => host.commandHandlers.installed_app_launch!({ payload: { payload: { launchSelector: selector, executablePath: 'caller.exe' } } }));
  assert.equal(launches, 1);
  await host.shutdown();
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
    async access() { return { available: false, reasonCode: 'LOCAL_APP_SESSION_REVOKED' }; },
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
      async access() { return { available: false, reasonCode: 'LOCAL_APP_SESSION_REVOKED' }; },
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
    async access() { return { available: false, reasonCode: 'LOCAL_APP_SESSION_REVOKED' }; },
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
