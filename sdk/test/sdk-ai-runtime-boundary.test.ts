import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';

const aiDir = new URL('../src/ai/', import.meta.url);
const runtimeDir = new URL('../src/runtime/', import.meta.url);

function listFiles(dir: URL): string[] {
  const root = dir.pathname;
  const out: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else if (path.endsWith('.ts')) {
        out.push(path.slice(root.length));
      }
    }
  };
  visit(root);
  return out.sort();
}

function readSource(dir: URL, relativePath: string): string {
  return readFileSync(join(dir.pathname, relativePath), 'utf8');
}

test('sdk ai subpath does not host runtime implementation helpers', () => {
  const aiFiles = listFiles(aiDir);
  assert.deepEqual(
    aiFiles.filter((file) => /^runtime[-.]/.test(basename(file))),
    [],
  );

  for (const file of aiFiles) {
    const source = readSource(aiDir, file);
    assert.doesNotMatch(source, /from ['"]\.\.\/runtime\/(?!index\.js['"])/);
    assert.doesNotMatch(source, /RuntimeMethodIds|MemoryBankScope|MemoryRequestContext/);
  }
});

test('sdk ai subpath does not host generic storage helpers', () => {
  const aiFiles = listFiles(aiDir);
  assert.equal(aiFiles.includes('local-storage.ts'), false);
  assert.doesNotMatch(readSource(aiDir, 'index.ts'), /local-storage/);
});

test('runtime agent memory helpers live on the runtime subpath', () => {
  const runtimeFiles = listFiles(runtimeDir);
  assert.ok(runtimeFiles.includes('runtime-agent-memory.ts'));
  assert.match(readSource(runtimeDir, 'index.ts'), /runtime-agent-memory\.js/);
  assert.match(readSource(runtimeDir, 'browser.ts'), /runtime-agent-memory\.js/);
});

test('AIConfig scheduling projection lives on the runtime subpath, not AI', () => {
  const aiFiles = listFiles(aiDir);
  const runtimeFiles = listFiles(runtimeDir);
  assert.equal(aiFiles.includes('ai-config-scheduling.ts'), false);
  assert.ok(runtimeFiles.includes('ai-config-scheduling.ts'));
  assert.doesNotMatch(readSource(aiDir, 'index.ts'), /ai-config-scheduling\.js/);
  assert.match(readSource(runtimeDir, 'index.ts'), /ai-config-scheduling\.js/);
});
