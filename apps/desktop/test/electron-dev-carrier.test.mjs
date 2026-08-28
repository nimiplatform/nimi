import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  resolveDesktopDevLaunchOptions,
  resolveDesktopDevObservationArguments,
  resolvePersistentDesktopDevProfile,
  resolveSignedDesktopDevCarrier,
  resolveWorkspaceElectronDevCarrier,
} from '../scripts/lib/electron-dev-carrier.mjs';
import {
  acquireDesktopDevSessionLock,
  resolveDesktopDevSessionEndpoint,
} from '../scripts/lib/electron-dev-session-lock.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..', '..');

function waitForChildOutput(child, marker, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child output ${marker}; stderr: ${stderr}`));
    }, timeoutMs);
    const onStdout = (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(marker)) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Child exited before ${marker} (code=${String(code)}); stderr: ${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

test('Desktop dev resolves the signed external Electron carrier and persistent profile', () => {
  const carrier = resolveSignedDesktopDevCarrier({
    platform: 'win32',
    architecture: 'x64',
    electronVersion: '42.5.0',
    workspaceRoot,
    existsSync: () => true,
  });
  assert.equal(carrier, path.join(
    workspaceRoot,
    '.nimi', 'local', 'electron-desktop-runtime', '42.5.0', 'Nimi Desktop Runtime.exe',
  ));
  assert.equal(
    resolvePersistentDesktopDevProfile(workspaceRoot),
    path.join(workspaceRoot, '.nimi', 'local', 'dev-profiles', 'desktop'),
  );
});

test('Desktop dev fails closed when the signed carrier is absent', () => {
  assert.throws(
    () => resolveSignedDesktopDevCarrier({
      platform: 'win32',
      architecture: 'x64',
      electronVersion: '42.5.0',
      workspaceRoot,
      existsSync: () => false,
    }),
    (error) => error.reasonCode === 'desktop-dev-signed-carrier-missing'
      && error.actionHint === 'prepare_signed_desktop_electron_runtime',
  );
});

test('Desktop dev rejects unsigned-carrier platforms instead of falling back to workspace Electron', () => {
  assert.throws(
    () => resolveSignedDesktopDevCarrier({
      platform: 'linux',
      architecture: 'x64',
      electronVersion: '42.5.0',
      workspaceRoot,
      existsSync: () => true,
    }),
    (error) => error.reasonCode === 'desktop-dev-signed-carrier-platform-unsupported',
  );
});

test('Desktop dev resolves workspace Electron for ordinary macOS host iteration', () => {
  const executable = path.join(
    workspaceRoot,
    'node_modules',
    'electron',
    'dist',
    'Electron.app',
    'Contents',
    'MacOS',
    'Electron',
  );
  assert.equal(resolveWorkspaceElectronDevCarrier({
    platform: 'darwin',
    architecture: 'arm64',
    electronExecutable: executable,
    existsSync: () => true,
  }), executable);
  assert.throws(() => resolveWorkspaceElectronDevCarrier({
    platform: 'darwin',
    architecture: 'arm64',
    electronExecutable: executable,
    existsSync: () => false,
  }), (error) => error.reasonCode === 'desktop-dev-workspace-carrier-missing');

  const windowsExecutable = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  assert.equal(resolveWorkspaceElectronDevCarrier({
    platform: 'win32',
    architecture: 'x64',
    electronExecutable: windowsExecutable,
    existsSync: () => true,
  }), windowsExecutable);
});

test('Desktop dev CDP observation is explicit, loopback-only, and fail-closed', () => {
  assert.deepEqual(resolveDesktopDevObservationArguments({}), []);
  assert.deepEqual(resolveDesktopDevObservationArguments({
    NIMI_DESKTOP_DEV_CDP_PORT: '19470',
  }), [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=19470',
  ]);
  assert.throws(
    () => resolveDesktopDevObservationArguments({ NIMI_DESKTOP_DEV_CDP_PORT: '80' }),
    (error) => error.reasonCode === 'desktop-dev-observation-port-invalid',
  );
});

test('Desktop dev accepts the guarded package-script CDP arguments', () => {
  assert.deepEqual(resolveDesktopDevLaunchOptions([
    '--',
    '--cdp-port',
    '9337',
  ], {}), {
    avatarOnly: false,
    observationArguments: [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9337',
    ],
  });
  assert.deepEqual(resolveDesktopDevLaunchOptions([
    '--avatar-only',
    '--cdp-port',
    '9337',
  ], {}), {
    avatarOnly: true,
    observationArguments: [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9337',
    ],
  });
});

test('Desktop dev accepts an explicit no-CDP launch and rejects conflicting configuration', () => {
  assert.deepEqual(resolveDesktopDevLaunchOptions(['--no-cdp'], {
    NIMI_DESKTOP_DEV_CDP_PORT: '9337',
  }), {
    avatarOnly: false,
    observationArguments: [],
  });
  assert.throws(
    () => resolveDesktopDevLaunchOptions(['--no-cdp', '--cdp-port', '9337'], {}),
    /may only be configured once/u,
  );
});

test('Desktop dev rejects malformed or unsupported package-script arguments', () => {
  assert.throws(
    () => resolveDesktopDevLaunchOptions(['--cdp-port'], {}),
    /requires a value/u,
  );
  assert.throws(
    () => resolveDesktopDevLaunchOptions(['--cdp-port', '9337', '--cdp-port', '9338'], {}),
    /may only be configured once/u,
  );
  assert.throws(
    () => resolveDesktopDevLaunchOptions(['--inspect'], {}),
    /Unsupported Desktop Electron dev argument/u,
  );
});

test('Windows Desktop dev session lock rejects a duplicate before it can rebuild shared SDK output', {
  skip: process.platform !== 'win32',
}, async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-dev-session-'));
  context.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const profileRoot = path.join(tempRoot, 'desktop');
  const first = await acquireDesktopDevSessionLock(profileRoot);

  assert.deepEqual(first.endpoint, resolveDesktopDevSessionEndpoint(profileRoot));
  await assert.rejects(
    acquireDesktopDevSessionLock(profileRoot),
    (error) => error.reasonCode === 'desktop-dev-session-active'
      && error.actionHint === 'stop_the_existing_desktop_dev_session',
  );

  await first.release();
  const relaunched = await acquireDesktopDevSessionLock(profileRoot);
  await relaunched.release();
});

test('Windows Desktop dev session lock is released by the kernel when its owner exits', {
  skip: process.platform !== 'win32',
}, async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-dev-session-exit-'));
  context.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const profileRoot = path.join(tempRoot, 'desktop');
  const helperUrl = pathToFileURL(path.resolve(
    import.meta.dirname,
    '../scripts/lib/electron-dev-session-lock.mjs',
  )).href;
  const child = spawn(process.execPath, [
    '--input-type=module',
    '--eval',
    [
      `const { acquireDesktopDevSessionLock } = await import(${JSON.stringify(helperUrl)});`,
      `await acquireDesktopDevSessionLock(${JSON.stringify(profileRoot)});`,
      `process.stdout.write('desktop-dev-session-ready\\n');`,
      'setInterval(() => {}, 60_000);',
    ].join('\n'),
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  });

  await waitForChildOutput(child, 'desktop-dev-session-ready');
  await assert.rejects(
    acquireDesktopDevSessionLock(profileRoot),
    (error) => error.reasonCode === 'desktop-dev-session-active',
  );

  const childExit = once(child, 'exit');
  child.kill('SIGKILL');
  await childExit;
  const session = await acquireDesktopDevSessionLock(profileRoot);
  await session.release();
});
