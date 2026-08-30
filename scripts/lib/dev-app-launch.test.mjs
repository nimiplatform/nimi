import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';

import {
  DEV_APP_DEFINITIONS,
  assertDevAppCdpPortAvailable,
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

test('Electron is the default carrier and enables the app CDP default', () => {
  assert.deepEqual(parseDevAppArguments('zhiyu'), {
    appName: 'zhiyu',
    carrier: 'electron',
    cdpPort: 9334,
    cdpDisabled: false,
    help: false,
    envOverrides: {},
  });
  const plan = resolveDevAppLaunch('zhiyu', [], { platform: 'darwin' });
  assert.equal(plan.carrier, 'electron');
  assert.equal(plan.cdpPort, 9334);
  assert.deepEqual(plan.args, [
    '--filter', '@nimiplatform/zhiyu', 'run', 'dev:electron', '--', '--cdp-port', '9334',
  ]);
  assert.equal(devAppLaunchSummary(plan), '[dev-app] zhiyu: Electron carrier; CDP http://127.0.0.1:9334\n');
});

test('each Electron app selects its default without exposing nested pnpm separators', () => {
  for (const [appName, definition] of Object.entries(DEV_APP_DEFINITIONS)) {
    const plan = resolveDevAppLaunch(appName, [], { platform: 'darwin' });
    assert.equal(plan.cdpPort, definition.defaultCdpPort);
    assert.deepEqual(plan.args.slice(-3), ['--', '--cdp-port', String(definition.defaultCdpPort)]);
  }
});

test('explicit CDP overrides accept separated and equals spellings', () => {
  for (const argv of [
    ['--cdp-port', '19472'],
    ['--cdp-port=19472'],
    ['--', '--cdp-port', '19472'],
  ]) {
    assert.equal(parseDevAppArguments('zhiyu', argv).cdpPort, 19472);
  }
});

test('CDP can be disabled explicitly and fails closed on conflicting or invalid input', () => {
  const disabled = parseDevAppArguments('desktop', ['--no-cdp']);
  assert.equal(disabled.cdpPort, undefined);
  assert.equal(disabled.cdpDisabled, true);
  assert.deepEqual(
    resolveDevAppLaunch('zhiyu', ['--no-cdp'], { platform: 'darwin' }).args.slice(-2),
    ['--', '--no-cdp'],
  );
  assert.throws(
    () => parseDevAppArguments('desktop', ['--no-cdp', '--cdp-port', '9333']),
    (error) => error.reasonCode === 'dev-app-cdp-duplicate',
  );
  assert.throws(
    () => parseDevAppArguments('desktop', ['--cdp-port']),
    (error) => error.reasonCode === 'dev-app-option-value-missing',
  );
  for (const port of ['01024', '1023', '65536', '9333.5', '9333x']) {
    assert.throws(
      () => parseDevAppArguments('desktop', [`--cdp-port=${port}`]),
      (error) => error.reasonCode === 'dev-app-cdp-port-invalid',
    );
  }
  assert.throws(
    () => parseDevAppArguments('desktop', ['--cdp']),
    (error) => error.reasonCode === 'dev-app-option-unsupported',
  );
});

test('Avatar Electron maps launch selectors to the existing Desktop carrier contract', () => {
  const plan = resolveDevAppLaunch('avatar', [
    '--agent-handle',
    `agent_ref_${'a'.repeat(43)}`,
    '--instance-id',
    'avatar-instance',
  ], { platform: 'darwin' });
  assert.equal(plan.carrier, 'electron');
  assert.equal(plan.cdpPort, 9336);
  assert.deepEqual(plan.envOverrides, {
    NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_HANDLE: `agent_ref_${'a'.repeat(43)}`,
    NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID: 'avatar-instance',
  });
  assert.throws(
    () => resolveDevAppLaunch('avatar', ['--uri', 'nimi-avatar://launch?agent_id=x']),
    (error) => error.reasonCode === 'dev-app-option-unsupported',
  );
});

test('help exposes the short interface and carrier constraints', () => {
  const output = devAppUsage('avatar');
  assert.match(output, /pnpm dev:avatar \[--cdp-port <port> \| --no-cdp\]/u);
  assert.match(output, /defaults to 127\.0\.0\.1:9336/u);
  assert.match(output, /cannot run beside the regular Desktop dev instance/u);
  assert.equal(resolveDevAppLaunch('avatar', ['--help']).kind, 'help');
  assert.throws(
    () => resolveDevAppLaunch('constructor'),
    (error) => error.reasonCode === 'dev-app-unknown',
  );
});

test('CDP port preflight fails clearly when the loopback port is occupied', async (context) => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.equal(typeof address, 'object');
  await assert.rejects(
    assertDevAppCdpPortAvailable(address.port),
    (error) => error.reasonCode === 'dev-app-cdp-port-in-use'
      && error.message.includes(`127.0.0.1:${address.port}`),
  );
  await assert.doesNotReject(assertDevAppCdpPortAvailable(undefined));
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
