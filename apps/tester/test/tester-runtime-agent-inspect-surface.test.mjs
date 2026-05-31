import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
let behaviorBuildDir = null;

function buildBehaviorModules() {
  if (behaviorBuildDir) return behaviorBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-agent-inspect-surface-'));
  execFileSync('pnpm', [
    'exec',
    'tsc',
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
    'src/tester/tester-runtime-agent-inspect-projection.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

async function importProjection() {
  return import(pathToFileURL(path.join(
    buildBehaviorModules(),
    'tester/tester-runtime-agent-inspect-projection.js',
  )).href);
}

test('Tester consumes SDK host Runtime agent inspect surface as second app proof', async () => {
  const projection = await importProjection();
  assert.deepEqual(await projection.inspectTesterRuntimeAgentSurfaceProjection(), {
    lifecycleStatus: 'active',
    presentationBackend: 'vrm',
    stateStatusText: 'tester ready',
  });
});
