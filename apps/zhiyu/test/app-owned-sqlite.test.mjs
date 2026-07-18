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
    assert.match(first.databasePath, /app-owned\/v1\/zhiyu\.sqlite3$/u);
    first.close();

    const second = await openZhiyuAppOwnedStore({ userDataRoot: root, nowUnixMs: 1_784_400_001_000 });
    assert.deepEqual(second.snapshot(), { appId: 'nimi.zhiyu', bootCount: 2, schemaVersion: 1 });
    second.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
