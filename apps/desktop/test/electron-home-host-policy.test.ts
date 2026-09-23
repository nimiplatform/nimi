import assert from 'node:assert/strict';
import test from 'node:test';
import { NIMI_STANDARD_SHELL_COMMANDS as COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { createDesktopHomeCommandPolicy } from '../src-electron/home-host-policy.js';
import { createDesktopAppActivitySourceLaunch } from '../src-electron/app-activity-source-launch-host.js';

test('Home setup/repair refuses model, business and activity work while retaining recovery', async () => {
  let allowed = false;
  const policy = createDesktopHomeCommandPolicy(() => allowed);
  const base = { appId: 'nimi.desktop', commandKind: 'standard' as const };
  for (const command of ['product_control_check_sync_start', 'runtime_account_begin_login', 'desktop_home_profile_retry', COMMANDS['file-dialog.open']]) {
    assert.equal((await policy({ ...base, command })).allow, true);
  }
  for (const runtimeMethodId of [
    '/nimi.runtime.v1.RuntimeLocalService/InstallModelFromPlan',
    '/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob',
    '/nimi.runtime.v1.RuntimeAppActivityService/ListAppActivities',
  ]) {
    assert.equal((await policy({ ...base, command: COMMANDS['runtime.unary'], runtimeMethodId })).allow, false);
  }
  assert.equal((await policy({ ...base, command: COMMANDS['runtime.unary'], runtimeMethodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth' })).allow, true);
  assert.equal((await policy({ ...base, command: 'runtime_account_invoke_realm_unary', realmMethodId: 'getMe' })).allow, true);
  assert.equal((await policy({ ...base, command: 'runtime_account_invoke_realm_unary', realmMethodId: 'createPost' })).allow, false);
  assert.equal((await policy({ ...base, command: 'installed_app_launch' })).allow, false);
  allowed = true;
  assert.equal((await policy({ ...base, command: 'installed_app_launch' })).allow, true);
});

test('App activity source navigation does not resolve or launch during Home recovery', async () => {
  let resolved = false;
  const launch = createDesktopAppActivitySourceLaunch({
    isAvailable: () => false,
    resolve: () => async () => { resolved = true; throw new Error('must not resolve'); },
    launchInstalled: () => undefined,
    startLocalDevelopment: () => undefined,
  });
  assert.deepEqual(await launch('activity-open-request'), { status: 'unavailable', reason: 'host-unavailable' });
  assert.equal(resolved, false);
});
