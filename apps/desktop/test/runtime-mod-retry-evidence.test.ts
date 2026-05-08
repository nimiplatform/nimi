import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/host/retry-runtime-mod.ts'),
  'utf8',
);

test('runtime mod retry requires target registration evidence before recovered success', () => {
  assert.match(source, /const registeredModIds = new Set<string>\(\)/);
  assert.match(source, /registeredModIds\.has\(normalizedModId\)/);
  assert.match(source, /retry-no-registration-evidence/);
  assert.match(
    source,
    /if \(!registeredModIds\.has\(normalizedModId\)\)[\s\S]*return;[\s\S]*input\.context\.clearModFuse\(normalizedModId\)/,
  );
});
