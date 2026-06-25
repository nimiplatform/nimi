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
  buildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-route-capability-runtime-'));
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
    'src/tester/tester-runtime-route-capability-runtime.ts',
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

test('tester consumes SDK runtime route capability host runtime as second app proof', async () => {
  const moduleUrl = pathToFileURL(path.join(buildModule(), 'tester/tester-runtime-route-capability-runtime.js')).href;
  const { createTesterRuntimeRouteCapabilityRuntimeProjection } = await import(moduleUrl);
  assert.deepEqual(await createTesterRuntimeRouteCapabilityRuntimeProjection(), {
    resolvedRef: 'cloud:text.generate:tester-cloud:remote-catalog%3Atester-cloud%3Atester-model:tester-model',
    healthStatus: 'healthy',
    describeTargetId: 'tester.capability.route',
    supportsThinking: true,
  });
});
