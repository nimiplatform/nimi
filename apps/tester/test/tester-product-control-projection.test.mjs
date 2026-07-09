import assert from 'node:assert/strict';
import { buildWithTsc } from './tsc-build.mjs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

function buildModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(root, '.tmp', 'product-control-'));
  buildWithTsc([
    '--outDir',
    buildDir,
    '--rootDir',
    '.',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--skipLibCheck',
    'true',
    '--types',
    'node',
    '--noEmit',
    'false',
    'test/proofs/tester-product-control-projection.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return buildDir;
}

test.after(() => {
  if (buildDir) {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test('tester consumes SDK Runtime product-control reconciliation helper as second app proof', async () => {
  const moduleUrl = pathToFileURL(path.join(buildModule(), 'test/proofs/tester-product-control-projection.js')).href;
  const { loadTesterProductControlProjection } = await import(moduleUrl);
  const projection = await loadTesterProductControlProjection();

  assert.equal(projection.runtimeMethod, 'reconcileProductControlFirstRunSetupState');
  assert.equal(projection.state, 'local_ai_assets_downloaded_environment_not_ready');
  assert.equal(projection.screen, 'setup');
  assert.equal(projection.admission, 'first-run');
  assert.equal(projection.storageDirs.localModelsDir, '/tester/nimi-data/models');
});
