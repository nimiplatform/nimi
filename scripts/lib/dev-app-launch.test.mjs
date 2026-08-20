import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  DEV_APP_DEFINITIONS,
  devAppLaunchSummary,
  devAppUsage,
  parseDevAppArguments,
  resolveDevAppLaunch,
} from './dev-app-launch.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');

test('development apps have stable non-conflicting default CDP ports', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(DEV_APP_DEFINITIONS).map(([appName, definition]) => [
      appName,
      definition.defaultCdpPort,
    ])),
    {
      desktop: 9333,
      zhiyu: 9334,
      lab: 9335,
      avatar: 9336,
    },
  );
  const ports = Object.values(DEV_APP_DEFINITIONS).map(({ defaultCdpPort }) => defaultCdpPort);
  assert.equal(new Set(ports).size, ports.length);
  const rendererPorts = new Set([1420, 1427, 1468, 1472]);
  assert.equal(ports.some((port) => rendererPorts.has(port)), false);
});

test('Electron is the default carrier and CDP remains explicitly disabled', () => {
  assert.deepEqual(parseDevAppArguments('zhiyu'), {
    appName: 'zhiyu',
    carrier: 'electron',
    cdpPort: undefined,
    help: false,
    avatarArguments: [],
    envOverrides: {},
  });
  const plan = resolveDevAppLaunch('zhiyu', [], { platform: 'darwin' });
  assert.equal(plan.carrier, 'electron');
  assert.equal(plan.cdpPort, undefined);
  assert.deepEqual(plan.args, ['--filter', '@nimiplatform/zhiyu', 'run', 'dev:electron']);
  assert.equal(devAppLaunchSummary(plan), '[dev-app] zhiyu: Electron carrier; CDP disabled\n');
});

test('--cdp selects each app default without exposing nested pnpm separators', () => {
  for (const [appName, definition] of Object.entries(DEV_APP_DEFINITIONS)) {
    const plan = resolveDevAppLaunch(appName, ['--cdp'], { platform: 'darwin' });
    assert.equal(plan.cdpPort, definition.defaultCdpPort);
    assert.deepEqual(plan.args.slice(-3), ['--', '--cdp-port', String(definition.defaultCdpPort)]);
  }
});

test('explicit CDP overrides accept the friendly and underlying spellings', () => {
  for (const argv of [
    ['--cdp=19472'],
    ['--cdp', '19472'],
    ['--cdp-port', '19472'],
    ['--', '--cdp-port', '19472'],
  ]) {
    assert.equal(parseDevAppArguments('zhiyu', argv).cdpPort, 19472);
  }
});

test('CDP input fails closed on duplicate, missing, and non-canonical ports', () => {
  assert.throws(
    () => parseDevAppArguments('desktop', ['--cdp', '--cdp=9333']),
    (error) => error.reasonCode === 'dev-app-cdp-duplicate',
  );
  assert.throws(
    () => parseDevAppArguments('desktop', ['--cdp-port']),
    (error) => error.reasonCode === 'dev-app-option-value-missing',
  );
  for (const port of ['01024', '1023', '65536', '9333.5', '9333x']) {
    assert.throws(
      () => parseDevAppArguments('desktop', [`--cdp=${port}`]),
      (error) => error.reasonCode === 'dev-app-cdp-port-invalid',
    );
  }
});

test('only Avatar admits the explicit Tauri carrier and never combines it with CDP', () => {
  const plan = resolveDevAppLaunch('avatar', [
    '--tauri',
    '--agent-id',
    'local-agent:owner:agent',
    '--instance-id',
    'avatar-instance',
    '--no-kill-existing',
  ], {
    nodeExecutable: '/node',
    platform: 'darwin',
  });
  assert.deepEqual(plan, {
    kind: 'launch',
    appName: 'avatar',
    carrier: 'tauri',
    cdpPort: undefined,
    command: '/node',
    args: [
      path.join('scripts', 'dev-avatar.mjs'),
      '--agent-id',
      'local-agent:owner:agent',
      '--instance-id',
      'avatar-instance',
      '--no-kill-existing',
    ],
    envOverrides: {},
  });
  assert.throws(
    () => resolveDevAppLaunch('avatar', ['--tauri', '--cdp']),
    (error) => error.reasonCode === 'dev-app-tauri-cdp-unsupported',
  );
  assert.throws(
    () => resolveDevAppLaunch('lab', ['--tauri']),
    (error) => error.reasonCode === 'dev-app-carrier-unsupported',
  );
  assert.throws(
    () => resolveDevAppLaunch('avatar', ['--electron', '--tauri']),
    (error) => error.reasonCode === 'dev-app-carrier-duplicate',
  );
});

test('Avatar Electron maps launch selectors to the existing Desktop carrier contract', () => {
  const plan = resolveDevAppLaunch('avatar', [
    '--agent-id',
    'local-agent:owner:agent',
    '--instance-id',
    'avatar-instance',
    '--cdp',
  ], { platform: 'darwin' });
  assert.equal(plan.carrier, 'electron');
  assert.equal(plan.cdpPort, 9336);
  assert.deepEqual(plan.envOverrides, {
    NIMI_AVATAR_AGENT_ID: 'local-agent:owner:agent',
    NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID: 'avatar-instance',
  });
  assert.throws(
    () => resolveDevAppLaunch('avatar', ['--uri', 'nimi-avatar://launch?agent_id=x']),
    (error) => error.reasonCode === 'dev-app-avatar-option-requires-tauri',
  );
});

test('help exposes the short interface and carrier constraints', () => {
  const output = devAppUsage('avatar');
  assert.match(output, /pnpm dev:avatar \[--cdp\[=<port>\]\] \[--tauri\]/u);
  assert.match(output, /default \(9336\)/u);
  assert.match(output, /cannot run beside the regular Desktop dev instance/u);
  assert.equal(resolveDevAppLaunch('avatar', ['--help']).kind, 'help');
  assert.throws(
    () => resolveDevAppLaunch('constructor'),
    (error) => error.reasonCode === 'dev-app-unknown',
  );
});

test('root package commands route canonical and explicit Electron names through one launcher', () => {
  const packageDocument = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(packageDocument.scripts['dev:desktop'], 'node scripts/dev-app.mjs desktop');
  assert.equal(packageDocument.scripts['dev:zhiyu'], 'node scripts/dev-app.mjs zhiyu');
  assert.equal(packageDocument.scripts['dev:lab'], 'node scripts/dev-app.mjs lab');
  assert.equal(packageDocument.scripts['dev:avatar'], 'node scripts/dev-app.mjs avatar');
  for (const appName of ['desktop', 'zhiyu', 'lab', 'avatar']) {
    assert.equal(
      packageDocument.scripts[`dev:electron:${appName}`],
      `node scripts/dev-app.mjs ${appName} --electron`,
    );
  }
});
