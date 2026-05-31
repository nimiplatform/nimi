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
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-agent-lifecycle-surface-'));
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
    'src/tester/tester-runtime-agent-lifecycle-surface.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

async function importProjection() {
  return import(pathToFileURL(path.join(
    buildBehaviorModules(),
    'tester/tester-runtime-agent-lifecycle-surface.js',
  )).href);
}

test('Tester consumes SDK host Runtime agent lifecycle surface as second app proof', async () => {
  const projection = await importProjection();
  const result = await projection.inspectTesterRuntimeAgentLifecycleSurface();
  assert.deepEqual(result, {
    initialized: 'local-agent:tester-user:tester-agent',
    terminated: 'local-agent:tester-user:tester-agent',
  });
});
