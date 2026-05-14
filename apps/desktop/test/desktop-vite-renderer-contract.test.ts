import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteConfigSource = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');

test('desktop production renderer does not inject Vite modulepreload fetch polyfills', () => {
  assert.match(viteConfigSource, /modulePreload:\s*{/);
  assert.match(viteConfigSource, /polyfill:\s*false/);
  assert.match(viteConfigSource, /resolveDependencies:\s*\(\)\s*=>\s*\[\]/);
  assert.doesNotMatch(
    viteConfigSource,
    /resolveDependencies:\s*\([^)]*deps[^)]*\)\s*=>\s*deps/,
  );
});
