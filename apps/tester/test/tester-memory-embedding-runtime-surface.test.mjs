import assert from 'node:assert/strict';
import { buildWithTsc } from './tsc-build.mjs';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
let behaviorBuildDir = null;

function buildBehaviorModules() {
  if (behaviorBuildDir) return behaviorBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'memory-embedding-runtime-'));
  buildWithTsc([
    '--outDir',
    behaviorBuildDir,
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
    'src/tester/tester-memory-embedding-runtime-projection.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

async function importProjection() {
  return import(pathToFileURL(path.join(
    buildBehaviorModules(),
    'tester/tester-memory-embedding-runtime-projection.js',
  )).href);
}

test('Tester consumes SDK host memory embedding runtime surface as second app proof', async () => {
  const projection = await importProjection();
  const result = await projection.inspectTesterMemoryEmbeddingRuntimeProjection();
  assert.deepEqual(result, {
    agentId: 'local-agent:tester-user:tester-agent',
    sourceKind: 'cloud',
    resolutionState: 'resolved',
    bindOutcome: 'already_bound',
  });
});
