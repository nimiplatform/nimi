import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MACOS_LOCAL_APP_HOST_EXECUTABLE,
  resolveMacOSLocalAppHostLaunch,
} from '../macos/local-app-host/contract.mjs';

test('macOS local-app host accepts only the exact supervised production launch shape', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-local-app-host-contract-')));
  try {
    const project = path.join(root, 'project');
    const mainEntry = path.join(project, 'dist-electron', 'main.js');
    const executable = path.join(root, 'Nimi Local App Host');
    const home = path.join(root, 'home');
    const profile = path.join(home, 'Library', 'Application Support', 'Nimi', 'Local App Hosts', 'v1', 'a'.repeat(64));
    await mkdir(path.dirname(mainEntry), { recursive: true, mode: 0o700 });
    await writeFile(mainEntry, 'export {};\n');
    await writeFile(executable, 'fixture');
    await mkdir(profile, { recursive: true, mode: 0o700 });
    await chmod(home, 0o750);
    const launchInput = {
      contractTestExpectedExecutable: executable,
      executable,
      homeDirectory: home,
      uid: process.getuid?.() ?? 0,
      workingDirectory: project,
    };
    const baseArguments = [
      executable,
      `--user-data-dir=${profile}`,
      `--nimi-local-app-main=${mainEntry}`,
      '--nimi-dev-renderer-url=http://127.0.0.1:1472',
    ];
    const resolved = resolveMacOSLocalAppHostLaunch({ ...launchInput, argv: baseArguments });
    assert.equal(resolved.mainEntry, mainEntry);
    assert.equal(resolved.userDataDirectory, profile);
    assert.equal(resolved.rendererOrigin, 'http://127.0.0.1:1472');

    const cdpResolved = resolveMacOSLocalAppHostLaunch({
      ...launchInput,
      argv: [
        ...baseArguments.slice(0, 2),
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=19481',
        ...baseArguments.slice(2),
      ],
    });
    assert.equal(cdpResolved.cdpPort, 19481);
    const autoCdpResolved = resolveMacOSLocalAppHostLaunch({
      ...launchInput,
      argv: [
        ...baseArguments.slice(0, 2),
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        ...baseArguments.slice(2),
      ],
    });
    assert.equal(autoCdpResolved.cdpPort, 0);
    assert.equal(MACOS_LOCAL_APP_HOST_EXECUTABLE.endsWith('/Contents/MacOS/Nimi Local App Host'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('macOS local-app host rejects incomplete or non-loopback CDP launch arguments on every platform', () => {
  const input = {
    executable: MACOS_LOCAL_APP_HOST_EXECUTABLE,
    homeDirectory: '/tmp',
    workingDirectory: '/tmp',
  };
  const baseArguments = [
    MACOS_LOCAL_APP_HOST_EXECUTABLE,
    '--user-data-dir=/tmp/nimi-profile',
    '--nimi-local-app-main=/tmp/main.js',
    '--nimi-dev-renderer-url=http://127.0.0.1:1472',
  ];
  assert.throws(() => resolveMacOSLocalAppHostLaunch({
    ...input,
    argv: [...baseArguments, '--remote-debugging-port=9222'],
  }), /local-app-host-launch-untrusted/u);
  assert.throws(() => resolveMacOSLocalAppHostLaunch({
    ...input,
    argv: [
      ...baseArguments,
      '--remote-debugging-address=0.0.0.0',
      '--remote-debugging-port=9222',
    ],
  }), /local-app-host-launch-untrusted/u);
});

test('macOS local-app host rejects copied main and replaced profile ancestry', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-local-app-host-link-')));
  try {
    const project = path.join(root, 'project');
    const mainEntry = path.join(project, 'dist-electron', 'main.js');
    const copiedMain = path.join(project, 'copied-main.js');
    const executable = path.join(root, 'Nimi Local App Host');
    const home = path.join(root, 'home');
    const profile = path.join(home, 'Library', 'Application Support', 'Nimi', 'Local App Hosts', 'v1', 'a'.repeat(64));
    await mkdir(path.dirname(mainEntry), { recursive: true, mode: 0o700 });
    await mkdir(profile, { recursive: true, mode: 0o700 });
    await writeFile(mainEntry, 'export {};\n');
    await writeFile(copiedMain, 'export {};\n');
    await writeFile(executable, 'fixture');
    const fixture = {
      argv: [
        executable,
        `--user-data-dir=${profile}`,
        `--nimi-local-app-main=${mainEntry}`,
        '--nimi-dev-renderer-url=http://127.0.0.1:1472',
      ],
      contractTestExpectedExecutable: executable,
      executable,
      homeDirectory: home,
      uid: process.getuid?.() ?? 0,
      workingDirectory: project,
    };
    assert.throws(() => resolveMacOSLocalAppHostLaunch({
      ...fixture,
      argv: fixture.argv.map((value) => value.startsWith('--nimi-local-app-main=')
        ? `--nimi-local-app-main=${copiedMain}`
        : value),
    }), /local-app-host-launch-untrusted/u);
    await rm(profile, { recursive: true, force: true });
    await symlink(root, profile);
    assert.throws(() => resolveMacOSLocalAppHostLaunch(fixture), /local-app-host-launch-untrusted/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
