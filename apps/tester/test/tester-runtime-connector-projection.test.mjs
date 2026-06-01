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
  buildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-connector-projection-'));
  buildWithTsc([
    '--outDir',
    buildDir,
    '--rootDir',
    'src',
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
    'src/tester/tester-runtime-connector-projection.ts',
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

test('tester consumes SDK runtime config connector projection as a second app proof', async () => {
  const moduleUrl = pathToFileURL(path.join(buildModule(), 'tester/tester-runtime-connector-projection.js')).href;
  const { createTesterRuntimeConnectorProjection } = await import(moduleUrl);
  assert.deepEqual(createTesterRuntimeConnectorProjection(), {
    draftLabel: 'Openai Compatible Connector',
    normalizedProvider: 'tester',
    modelCount: 2,
    imageCapabilityModels: ['tester-image'],
    status: 'healthy',
  });
});
