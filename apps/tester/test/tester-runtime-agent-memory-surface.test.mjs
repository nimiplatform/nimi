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
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-agent-memory-surface-'));
  buildWithTsc([
    '--outDir',
    behaviorBuildDir,
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
    'test/proofs/tester-runtime-agent-memory-surface.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

async function importProjection() {
  return import(pathToFileURL(path.join(
    buildBehaviorModules(),
    'test/proofs/tester-runtime-agent-memory-surface.js',
  )).href);
}

test('Tester consumes SDK host Runtime agent memory surface as second app proof', async () => {
  const projection = await importProjection();
  const result = await projection.inspectTesterRuntimeAgentMemorySurfaceProjection();
  assert.deepEqual(result, {
    mode: 'standard',
    bankId: 'tester-agent-bank',
    pendingCutover: true,
  });
});
