import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testerRoot = resolve(__dirname, '..');
const aiConfigStoreSource = readFileSync(resolve(testerRoot, 'src/tester/tester-ai-config-store.ts'), 'utf8');

test('Tester AIConfig uses the admitted app-lab AIScopeRef factory', () => {
  assert.match(aiConfigStoreSource, /export function createTesterAppLabAIScopeRef\(\): NimiAIScopeRef/);
  assert.match(aiConfigStoreSource, /createTesterAppLabAIScopeRef\(\)/);
  assert.doesNotMatch(
    aiConfigStoreSource,
    /\{\s*kind:\s*['"]app['"],\s*ownerId:\s*['"]tester\.app['"],\s*surfaceId:\s*['"]settings['"]\s*\}/,
  );
});
