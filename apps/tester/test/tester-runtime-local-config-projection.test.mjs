import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

function buildModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-local-config-'));
  execFileSync('pnpm', [
    'exec',
    'tsc',
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
    'src/tester/tester-runtime-local-config-projection.ts',
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

test('tester consumes SDK runtime local config projection as a second app proof', async () => {
  const moduleUrl = pathToFileURL(path.join(buildModule(), 'tester/tester-runtime-local-config-projection.js')).href;
  const { createTesterRuntimeLocalConfigProjection } = await import(moduleUrl);
  assert.deepEqual(createTesterRuntimeLocalConfigProjection(), {
    preferredLocalModelId: 'tester-active',
    normalizedEndpoint: 'http://127.0.0.1:11434/v1',
    nodeProvider: 'runtime-local',
    nodeAvailable: true,
  });
});
