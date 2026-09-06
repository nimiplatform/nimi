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
