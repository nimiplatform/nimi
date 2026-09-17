import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertLocalDevelopmentPackageScripts, resolveLocalDevelopmentHostSourceDirectory } from '../src-electron/local-development-plan.js';

const scripts = {
  dev: 'nimi-app dev --shell electron',
  'dev:shell': 'nimi-app dev',
  'dev:renderer': 'next dev --hostname 127.0.0.1 --port 6002',
  'build:electron': 'node scripts/build-electron.mjs',
};

test('supervised development accepts the existing Next renderer without changing its command', () => {
  const original = structuredClone(scripts);
  assert.doesNotThrow(() => assertLocalDevelopmentPackageScripts(scripts));
  assert.deepEqual(scripts, original);
  assert.doesNotThrow(() => assertLocalDevelopmentPackageScripts({ ...scripts, 'dev:renderer': 'vite --host 127.0.0.1 --port 6002 --strictPort' }));
});

test('framework-neutral renderer support still requires the official supervisor and real commands', () => {
  for (const changes of [
    { dev: 'electron .' },
    { 'dev:renderer': '' },
    { 'dev:renderer': 'pnpm run dev:renderer' },
    { 'dev:renderer': 'nimi-app dev' },
    { 'dev:renderer': 'next dev\nnode extra.mjs' },
    { 'build:electron': '' },
  ]) {
    assert.throws(() => assertLocalDevelopmentPackageScripts({ ...scripts, ...changes }), /local-development-project-changed/);
  }
});

test('resolves an App-owned Host source directory before launch and keeps the scaffold default', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-host-source-'));
  try {
    for (const name of ['src-electron', 'electron']) await mkdir(path.join(root, name));
    assert.equal(await resolveLocalDevelopmentHostSourceDirectory(root, undefined), await realpath(path.join(root, 'src-electron')));
    assert.equal(await resolveLocalDevelopmentHostSourceDirectory(root, 'electron'), await realpath(path.join(root, 'electron')));
    await writeFile(path.join(root, 'file.ts'), 'export {};');
    for (const invalid of ['missing', 'file.ts', '../other', '/tmp', '.', 'electron/../src-electron', 'electron\\main']) {
      await assert.rejects(resolveLocalDevelopmentHostSourceDirectory(root, invalid), /local-development-host-source-unavailable/);
    }
    if (process.platform !== 'win32') {
      await symlink(os.tmpdir(), path.join(root, 'outside'));
      await assert.rejects(resolveLocalDevelopmentHostSourceDirectory(root, 'outside'), /local-development-host-source-unavailable/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
