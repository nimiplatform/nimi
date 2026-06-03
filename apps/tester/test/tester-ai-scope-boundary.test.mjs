import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readTesterSettingsSurface } from './settings-surface-read.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testerRoot = resolve(__dirname, '..');
const testerSettingsSource = readTesterSettingsSurface(testerRoot);

test('Tester settings uses the admitted app-lab AIScopeRef factory', () => {
  assert.match(testerSettingsSource, /createTesterAppLabAIScopeRef\(\)/);
  assert.doesNotMatch(
    testerSettingsSource,
    /\{\s*kind:\s*['"]app['"],\s*ownerId:\s*['"]tester\.app['"],\s*surfaceId:\s*['"]settings['"]\s*\}/,
  );
});
