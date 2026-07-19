import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertMacOSDesktopAcceptanceProfile } from '../src-electron/macos-desktop-acceptance.js';

const isWindows = process.platform === 'win32';

test('macOS Desktop accepts only one complete private loopback CDP profile', { skip: isWindows }, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-macos-desktop-acceptance-')));
  const desktopUserData = path.join(root, 'desktop-user-data');
  const zhiyuUserData = path.join(root, 'zhiyu-user-data');
  await chmod(root, 0o700);
  await mkdir(desktopUserData, { mode: 0o700 });
  await mkdir(zhiyuUserData, { mode: 0o700 });
  const env = acceptanceEnvironment(root);
  const argv = [
    '/Applications/Nimi Dev.app/Contents/MacOS/Nimi Dev',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=19470',
    `--user-data-dir=${desktopUserData}`,
  ];
  try {
    assert.doesNotThrow(() => assertMacOSDesktopAcceptanceProfile({
      platform: 'darwin',
      macOSLocalDevelopmentBuild: true,
      commandLine: commandLine({
        'remote-debugging-address': '127.0.0.1',
        'remote-debugging-port': '19470',
        'user-data-dir': desktopUserData,
      }),
      argv,
      env,
    }));

    assert.throws(() => assertMacOSDesktopAcceptanceProfile({
      platform: 'darwin',
      macOSLocalDevelopmentBuild: true,
      commandLine: commandLine({
        'remote-debugging-address': '127.0.0.1',
        'remote-debugging-port': '19470',
        'remote-debugging-pipe': '',
        'user-data-dir': desktopUserData,
      }, ['remote-debugging-pipe']),
      argv: [...argv, '--remote-debugging-pipe'],
      env,
    }), isAcceptanceFailure);

    await writeFile(path.join(root, 'oauth-authorization-url.txt'), 'stale\n');
    assert.throws(() => assertMacOSDesktopAcceptanceProfile({
      platform: 'darwin',
      macOSLocalDevelopmentBuild: true,
      commandLine: commandLine({
        'remote-debugging-address': '127.0.0.1',
        'remote-debugging-port': '19470',
        'user-data-dir': desktopUserData,
      }),
      argv,
      env,
    }), isAcceptanceFailure);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('macOS Desktop rejects symlinked acceptance ancestry and partial profiles', { skip: isWindows }, async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-macos-desktop-acceptance-link-')));
  const canonicalRoot = path.join(parent, 'canonical');
  const linkedRoot = path.join(parent, 'linked');
  await mkdir(canonicalRoot, { mode: 0o700 });
  await mkdir(path.join(canonicalRoot, 'desktop-user-data'), { mode: 0o700 });
  await mkdir(path.join(canonicalRoot, 'zhiyu-user-data'), { mode: 0o700 });
  await symlink(canonicalRoot, linkedRoot, 'dir');
  try {
    const desktopUserData = path.join(linkedRoot, 'desktop-user-data');
    assert.throws(() => assertMacOSDesktopAcceptanceProfile({
      platform: 'darwin',
      macOSLocalDevelopmentBuild: true,
      commandLine: commandLine({
        'remote-debugging-address': '127.0.0.1',
        'remote-debugging-port': '19470',
        'user-data-dir': desktopUserData,
      }),
      argv: [
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=19470',
        `--user-data-dir=${desktopUserData}`,
      ],
      env: acceptanceEnvironment(linkedRoot),
    }), isAcceptanceFailure);

    assert.throws(() => assertMacOSDesktopAcceptanceProfile({
      platform: 'darwin',
      macOSLocalDevelopmentBuild: true,
      commandLine: commandLine({ 'remote-debugging-port': '19470' }),
      argv: ['--remote-debugging-port=19470'],
      env: {},
    }), isAcceptanceFailure);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

function acceptanceEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    NIMI_MACOS_DEV_ACCEPTANCE: '1',
    NIMI_MACOS_DEV_ACCEPTANCE_ROOT: root,
    NIMI_MACOS_DEV_ACCEPTANCE_DESKTOP_USER_DATA_ROOT: path.join(root, 'desktop-user-data'),
    NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: path.join(root, 'oauth-authorization-url.txt'),
    NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT: root,
    NIMI_DEV_KERNEL_CHECKPOINT: '1',
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT: '19471',
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: path.join(root, 'zhiyu-user-data'),
  };
}

function commandLine(values: Readonly<Record<string, string>>, switches: readonly string[] = []) {
  const present = new Set([...Object.keys(values), ...switches]);
  return {
    getSwitchValue: (name: string) => values[name] ?? '',
    hasSwitch: (name: string) => present.has(name),
  };
}

function isAcceptanceFailure(error: unknown): boolean {
  return Boolean(error && typeof error === 'object'
    && 'reasonCode' in error
    && error.reasonCode === 'desktop-dev-acceptance-profile-invalid');
}
