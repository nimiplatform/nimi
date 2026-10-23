import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPackage, listPackage } from '@electron/asar';
import { assertNoCompilerSourceMaps, assertReleaseDebugSeparation, preserveReleaseSourceMaps, stageReleaseTree } from '../lib/release-source-maps.mjs';

test('custom release destinations cannot include or enter private debug storage', () => {
  const debug = path.resolve('local/debug-symbols');
  for (const output of [debug, path.dirname(debug), path.join(debug, 'release'), debug.toUpperCase()]) {
    assert.throws(() => assertReleaseDebugSeparation(output, debug), /must be disjoint/u);
  }
  assert.doesNotThrow(() => assertReleaseDebugSeparation(path.resolve('local/releases/current'), debug));
  assert.doesNotThrow(() => assertReleaseDebugSeparation(path.resolve('local/debug-symbols-copy'), debug));
});

test('staging preserves executable bytes and private maps but excludes maps from an actual ASAR', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nimi-release-maps-'));
  try {
    const source = path.join(temp, 'built');
    const staged = path.join(temp, 'staged');
    const transactionRoot = path.join(temp, 'transaction');
    const debug = path.join(transactionRoot, 'source-maps', 'dist');
    const files = {
      'assets/app.js': 'export const value = 42;\n//# sourceMappingURL=app.js.map',
      'assets/app.js.map': '{"version":3,"file":"app.js","sources":["app.ts"],"sourcesContent":["export const value = 42"],"names":[],"mappings":"AAAA"}',
      'assets/app.css': 'body { color: black }',
      'assets/app.css.map': '{"version":3,"sources":["app.css"]}',
      'native.node': 'native bytes',
      'resources/terrain.map': 'runtime data',
    };
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(source, name)), { recursive: true });
      await writeFile(path.join(source, name), content);
    }
    await stageReleaseTree(source, staged, debug);
    const asar = path.join(temp, 'app.asar');
    await createPackage(staged, asar);
    const entries = listPackage(asar, { isPack: false });
    assertNoCompilerSourceMaps(entries);
    for (const name of ['assets/app.js', 'assets/app.css', 'native.node', 'resources/terrain.map']) {
      assert.equal(await readFile(path.join(staged, name), 'utf8'), files[name]);
    }
    const privateRoot = await preserveReleaseSourceMaps({ transactionRoot, localRoot: path.join(temp, 'local'), sourceRevision: 'a'.repeat(40), target: 'windows-amd64' });
    assert.equal(path.dirname(privateRoot), path.join(temp, 'local', 'debug-symbols'));
    assert.equal(await readFile(path.join(privateRoot, 'dist/assets/app.js.map'), 'utf8'), files['assets/app.js.map']);
    assert.equal(await readFile(path.join(source, 'assets/app.js.map'), 'utf8'), files['assets/app.js.map']);
    await assert.rejects(readFile(path.join(staged, 'assets/app.js.map')), { code: 'ENOENT' });
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    await rm(temp, { recursive: true, force: true });
  }
});
