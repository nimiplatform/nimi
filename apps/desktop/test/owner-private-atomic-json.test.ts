import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readdir, readFile, realpath, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeOwnerPrivateAtomicJson } from '../src-electron/owner-private-atomic-json';

async function withFileHandleSyncCounter<T>(
  run: (getSyncCalls: () => number) => Promise<T>,
): Promise<T> {
  const probeDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-atomic-json-sync-probe-')));
  const probeFile = path.join(probeDir, 'probe');
  let proto: { sync: () => Promise<void> };
  const handle = await open(probeFile, 'w');
  try {
    proto = Object.getPrototypeOf(handle) as { sync: () => Promise<void> };
  } finally {
    await handle.close();
    await rm(probeDir, { recursive: true, force: true });
  }
  const originalSync = proto.sync;
  let syncCalls = 0;
  proto.sync = async function (this: unknown) {
    syncCalls += 1;
    return await originalSync.call(this);
  };
  try {
    return await run(() => syncCalls);
  } finally {
    proto.sync = originalSync;
  }
}

test('writeOwnerPrivateAtomicJson preserves durable fsync by default and when explicitly durable', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-atomic-json-durable-')));
  const targetDir = path.join(root, 'private-dir');
  const targetPath = path.join(targetDir, 'state.v1.json');
  try {
    await withFileHandleSyncCounter(async (getSyncCalls) => {
      await writeOwnerPrivateAtomicJson(targetPath, { version: 1, durable: true }, 'durable-default');
      assert.equal(getSyncCalls(), 1);
      assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), { version: 1, durable: true });
      assert.deepEqual(await readdir(targetDir), ['state.v1.json']);

      await writeOwnerPrivateAtomicJson(
        targetPath,
        { version: 2, durable: true },
        'durable-explicit',
        { durability: 'durable' },
      );
      assert.equal(getSyncCalls(), 2);
      assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), { version: 2, durable: true });
      assert.deepEqual(await readdir(targetDir), ['state.v1.json']);

      if (process.platform !== 'win32') {
        assert.equal((await stat(targetDir)).mode & 0o777, 0o700);
        assert.equal((await stat(targetPath)).mode & 0o777, 0o600);
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeOwnerPrivateAtomicJson skips fsync only for ephemeral-liveness while keeping atomic replace and symlink guards', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-atomic-json-ephemeral-')));
  const targetDir = path.join(root, 'presence');
  const targetPath = path.join(targetDir, 'presence.v1.json');
  const realDir = path.join(root, 'real-dir');
  const linkDir = path.join(root, 'link-dir');
  try {
    await withFileHandleSyncCounter(async (getSyncCalls) => {
      await writeOwnerPrivateAtomicJson(
        targetPath,
        { tick: 1 },
        'desktop-open-presence',
        { durability: 'ephemeral-liveness' },
      );
      await writeOwnerPrivateAtomicJson(
        targetPath,
        { tick: 2 },
        'desktop-open-presence',
        { durability: 'ephemeral-liveness' },
      );
      assert.equal(getSyncCalls(), 0);
      assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), { tick: 2 });
      assert.deepEqual(await readdir(targetDir), ['presence.v1.json']);

      if (process.platform !== 'win32') {
        assert.equal((await stat(targetDir)).mode & 0o777, 0o700);
        assert.equal((await stat(targetPath)).mode & 0o777, 0o600);
      }

      await mkdir(realDir, { mode: 0o700 });
      await symlink(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(
        writeOwnerPrivateAtomicJson(
          path.join(linkDir, 'presence.v1.json'),
          { tick: 3 },
          'desktop-open-presence',
          { durability: 'ephemeral-liveness' },
        ),
        /desktop-open-presence-parent-must-not-be-symlink/u,
      );
      assert.equal(getSyncCalls(), 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
