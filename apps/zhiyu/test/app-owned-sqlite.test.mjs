import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openZhiyuAppOwnedStore } from '../src-electron/app-owned-store.ts';

test('Zhiyu owns its private SQLite without a Nimi permission row', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'nimi-zhiyu-app-owned-')));
  await chmod(root, 0o700);
  try {
    const first = await openZhiyuAppOwnedStore({ userDataRoot: root, nowUnixMs: 1_784_400_000_000 });
    assert.deepEqual(first.snapshot(), { appId: 'nimi.zhiyu', bootCount: 1, schemaVersion: 1 });
    assert.equal(
      path.relative(root, first.databasePath),
      path.join('app-owned', 'v1', 'zhiyu.sqlite3'),
    );
    first.close();

    const second = await openZhiyuAppOwnedStore({ userDataRoot: root, nowUnixMs: 1_784_400_001_000 });
    assert.deepEqual(second.snapshot(), { appId: 'nimi.zhiyu', bootCount: 2, schemaVersion: 1 });
    second.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Zhiyu app-owned SQLite does not cross opaque supervisor partitions', async () => {
  const firstRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'nimi-zhiyu-partition-a-')));
  const secondRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'nimi-zhiyu-partition-b-')));
  if (process.platform !== 'win32') {
    await chmod(firstRoot, 0o700);
    await chmod(secondRoot, 0o700);
  }
  try {
    const first = await openZhiyuAppOwnedStore({ userDataRoot: firstRoot, nowUnixMs: 1_784_400_002_000 });
    const second = await openZhiyuAppOwnedStore({ userDataRoot: secondRoot, nowUnixMs: 1_784_400_003_000 });
    assert.notEqual(first.databasePath, second.databasePath);
    assert.equal(first.snapshot().bootCount, 1);
    assert.equal(second.snapshot().bootCount, 1);
    first.close();
    second.close();
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});
