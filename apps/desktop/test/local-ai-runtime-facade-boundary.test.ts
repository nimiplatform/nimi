import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workspaceRoot = path.join(import.meta.dirname, '..');

function collectFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath, predicate));
      continue;
    }
    if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function readProductionSources(relativeDirs: string[]): string {
  return relativeDirs.flatMap((relativeDir) => (
    collectFiles(path.join(workspaceRoot, relativeDir), (filePath) => (
      /\.(ts|tsx)$/.test(filePath)
      && !filePath.endsWith('.test.ts')
      && !filePath.endsWith('.test.tsx')
    ))
  )).map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
}

const desktopProjectionSources = readProductionSources([
  'src/runtime/local-runtime',
  'src/shell/renderer/features/runtime-config',
]);

test('Desktop local AI projections do not own Runtime storage or hardware detection', () => {
  assert.doesNotMatch(desktopProjectionSources, /\breadTextFile\b|\bwriteTextFile\b|\bfs\./);
  assert.doesNotMatch(desktopProjectionSources, /state\.json/);
  assert.doesNotMatch(desktopProjectionSources, /CUDA_PATH|cudart|nvidia-smi|nvcc/i);
  assert.doesNotMatch(desktopProjectionSources, /process\.env\.PATH|setx\s+PATH|setEnvironmentVariable/i);
  assert.doesNotMatch(desktopProjectionSources, /runtime\/internal/);
});
