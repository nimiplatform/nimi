import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspace(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const mainSource = readWorkspace('src/shell/renderer/main.tsx');
const stylesSource = readWorkspace('src/shell/renderer/styles.css');

test('desktop theme entry uses shared Nimi theme runtime', () => {
  assert.match(mainSource, /@nimiplatform\/nimi-kit\/ui/u);
  assert.match(mainSource, /NimiThemeProvider/u);
  assert.match(mainSource, /accentPack="desktop-accent"/u);
  assert.match(mainSource, /defaultScheme="light"/u);
});

test('desktop stylesheet imports shared foundation and accent packs only', () => {
  assert.match(stylesSource, /@nimiplatform\/nimi-kit\/ui\/styles\.css/u);
  assert.match(stylesSource, /@nimiplatform\/nimi-kit\/ui\/themes\/light\.css/u);
  assert.match(stylesSource, /@nimiplatform\/nimi-kit\/ui\/themes\/dark\.css/u);
  assert.match(stylesSource, /@nimiplatform\/nimi-kit\/ui\/themes\/desktop-accent\.css/u);
  assert.doesNotMatch(stylesSource, /relay-dark\.css|overtone-studio\.css/u);
});

test('desktop stylesheet does not recreate shared token or primitive authority', () => {
  assert.doesNotMatch(stylesSource, /(^|\n)\s*\.nimi-[^\n]*\{/u);
  assert.doesNotMatch(stylesSource, /--nimi-[a-z0-9-]+\s*:/u);
  assert.doesNotMatch(stylesSource, /@theme\s*\{/u);
  assert.doesNotMatch(stylesSource, /--color-brand-|--color-accent-/u);
});
