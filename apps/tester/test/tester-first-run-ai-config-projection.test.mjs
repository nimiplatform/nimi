import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildWithTsc } from './tsc-build.mjs';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

function buildModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(root, '.tmp', 'first-run-ai-config-'));
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
    'test/proofs/tester-first-run-ai-config-projection.ts',
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

test('Tester consumes SDK first-run execution evidence AIConfig projection', async () => {
  const moduleUrl = pathToFileURL(path.join(
    buildModule(),
    'test/proofs/tester-first-run-ai-config-projection.js',
  )).href;
  const { createTesterFirstRunAIConfigProjection } = await import(moduleUrl);
  assert.deepEqual(createTesterFirstRunAIConfigProjection(), {
    'audio.synthesize': 'tester-execution-evidence',
    'audio.transcribe': 'tester-execution-evidence',
    'text.generate': 'tester-execution-evidence',
  });
});
