import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureDesktopTemporaryEnvironment,
  desktopHomeBootstrapSlot,
  prepareDesktopHomeHostProfile,
  prepareDesktopHomeRootProfile,
} from '../src-electron/home-host-profile.js';

const SCOPE_NAME = '0123456789abcdef0123456789abcdef';

async function fixture(label: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), `nimi-home-profile-${label}-`));
  const dataRoot = path.join(root, 'nimi_data');
  const originalTemp = path.join(root, 'os-temp');
  await mkdir(dataRoot, { recursive: true });
  await mkdir(originalTemp, { recursive: true });
  return { root, dataRoot, originalTemp, scope: path.join(dataRoot, 'app-hosts', SCOPE_NAME) };
}

test('Home uses <scope>/desktop under the selected root and clears its known bootstrap slot', async () => {
  const { root, originalTemp, scope } = await fixture('root');
  try {
    const environment: NodeJS.ProcessEnv = { TEMP: originalTemp };
    const temporaryEnvironment = captureDesktopTemporaryEnvironment(environment, () => originalTemp);
    const slot = desktopHomeBootstrapSlot(originalTemp, 'fixed-instance');
    await mkdir(path.join(slot, 'profile', 'tmp'), { recursive: true });
    await writeFile(path.join(slot, 'profile', 'tmp', 'stale'), 'stale');

    const profile = await prepareDesktopHomeHostProfile({
      readScopeRoot: async () => scope,
      singleInstanceScope: 'fixed-instance',
      temporaryEnvironment,
    });
    assert.equal(profile.mode, 'root');
    assert.equal(profile.scopeRoot, scope);
    assert.equal(profile.profileRoot, path.join(scope, 'desktop'));
    for (const directory of [profile.userData, profile.sessionData, profile.temp]) {
      assert.equal((await stat(directory)).isDirectory(), true);
      assert.deepEqual(await readdir(directory), [], 'write probes must not remain');
    }
    await assert.rejects(stat(slot), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a shared data root keeps its exact mode on app-hosts despite the process umask', {
  skip: process.platform === 'win32' ? 'POSIX modes only' : false,
}, async () => {
  const { root, dataRoot, scope } = await fixture('shared-mode');
  const previousUmask = process.umask(0o022);
  try {
    await chmod(dataRoot, 0o775);
    await prepareDesktopHomeRootProfile(scope, process.platform);
    // Another OS user must still be able to create a scope beside this one.
    assert.equal((await stat(path.dirname(scope))).mode & 0o7777, 0o775);
    assert.equal((await stat(scope)).mode & 0o7777, 0o700);
  } finally {
    process.umask(previousUmask);
    await rm(root, { recursive: true, force: true });
  }
});

test('Home falls back to one explicit single-instance bootstrap slot and reuses it', async () => {
  const { root, originalTemp } = await fixture('bootstrap');
  try {
    const temporaryEnvironment = captureDesktopTemporaryEnvironment({ TEMP: originalTemp }, () => originalTemp);
    const unavailable = async (): Promise<string> => {
      throw Object.assign(new Error('desktop-product-control-host-profile-scope-unavailable'), {
        reasonCode: 'desktop-product-control-host-profile-scope-unavailable',
      });
    };
    const first = await prepareDesktopHomeHostProfile({
      readScopeRoot: unavailable,
      singleInstanceScope: 'fixed-instance',
      temporaryEnvironment,
    });
    const slot = desktopHomeBootstrapSlot(originalTemp, 'fixed-instance');
    assert.equal(first.mode, 'bootstrap');
    assert.equal(first.scopeRoot, null);
    assert.equal(first.bootstrapReason, 'desktop-product-control-host-profile-scope-unavailable');
    assert.equal(first.profileRoot, path.join(slot, 'profile'));
    await writeFile(path.join(first.temp, 'left-by-previous-run'), 'x');

    const second = await prepareDesktopHomeHostProfile({
      readScopeRoot: unavailable,
      singleInstanceScope: 'fixed-instance',
      temporaryEnvironment,
    });
    assert.equal(second.profileRoot, first.profileRoot, 'the known slot is reused, not multiplied');
    assert.deepEqual(await readdir(second.temp), [], 'the previous slot content is cleared before reuse');
    assert.deepEqual(await readdir(path.dirname(slot)), [path.basename(slot)]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a malformed or unwritable scope never becomes a data root fallback', async () => {
  const { root, dataRoot, originalTemp } = await fixture('invalid');
  try {
    const temporaryEnvironment = captureDesktopTemporaryEnvironment({}, () => originalTemp);
    for (const scope of [path.join(dataRoot, 'app-hosts', 'short'), 'relative/app-hosts/' + SCOPE_NAME, path.join(dataRoot, SCOPE_NAME)]) {
      await assert.rejects(prepareDesktopHomeRootProfile(scope), /desktop-home-profile-scope-invalid/u);
      const profile = await prepareDesktopHomeHostProfile({
        readScopeRoot: async () => scope,
        singleInstanceScope: 'fixed-instance',
        temporaryEnvironment,
      });
      assert.equal(profile.mode, 'bootstrap');
    }
    const blockedScope = path.join(dataRoot, 'app-hosts', SCOPE_NAME);
    await mkdir(path.dirname(blockedScope), { recursive: true });
    await writeFile(blockedScope, 'a file where the scope directory belongs');
    await assert.rejects(prepareDesktopHomeRootProfile(blockedScope), /desktop-home-profile-not-directory/u);
    await assert.rejects(stat(path.join(dataRoot, 'app-hosts', SCOPE_NAME, 'desktop')), /ENOTDIR|ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restoring the captured temporary environment deletes keys that were originally absent', () => {
  const environment: NodeJS.ProcessEnv = { TEMP: 'C:\\original-temp', TMPDIR: '/original/tmpdir' };
  const temporaryEnvironment = captureDesktopTemporaryEnvironment(environment, () => 'C:\\original-temp');
  temporaryEnvironment.apply('D:\\nimi_data\\app-hosts\\scope\\desktop\\tmp');
  assert.equal(environment.TEMP, 'D:\\nimi_data\\app-hosts\\scope\\desktop\\tmp');
  assert.equal(environment.TMP, 'D:\\nimi_data\\app-hosts\\scope\\desktop\\tmp');
  assert.equal(environment.TMPDIR, 'D:\\nimi_data\\app-hosts\\scope\\desktop\\tmp');
  temporaryEnvironment.restore();
  assert.deepEqual(environment, { TEMP: 'C:\\original-temp', TMPDIR: '/original/tmpdir' });
  assert.equal(Object.prototype.hasOwnProperty.call(environment, 'TMP'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(environment, 'SystemTemp'), false);
  // The bootstrap slot derives from the captured original directory, so a
  // relaunched instance cannot nest it inside this instance's profile tmp.
  assert.equal(
    desktopHomeBootstrapSlot(temporaryEnvironment.originalTempDirectory, 'fixed-instance'),
    desktopHomeBootstrapSlot(path.resolve('C:\\original-temp'), 'fixed-instance'),
  );
});

test('the relaunch marker limits automatic startup retries but allows explicit repair', async () => {
  const { shouldRetryDesktopHomeProfile } = await import('../src-electron/home-host-profile.js');
  const input = { mode: 'bootstrap' as const, alreadyRelaunched: true, startupSettled: false };
  assert.equal(shouldRetryDesktopHomeProfile({ ...input, trigger: 'startup' }), false);
  assert.equal(shouldRetryDesktopHomeProfile({ ...input, trigger: 'activation' }), false);
  assert.equal(shouldRetryDesktopHomeProfile({ ...input, startupSettled: true, trigger: 'command' }), false);
  assert.equal(shouldRetryDesktopHomeProfile({ ...input, startupSettled: true, trigger: 'user-action' }), true);
  assert.equal(shouldRetryDesktopHomeProfile({ ...input, startupSettled: true, trigger: 'activation' }), true);
});
