import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspace(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const mainSource = readWorkspace('src/shell/renderer/main.tsx');
const foundationSource = readWorkspace('src/shell/renderer/foundation.css');
const stylesSource = readWorkspace('src/shell/renderer/styles.css');

test('desktop theme entry uses shared Nimi theme runtime', () => {
  assert.match(mainSource, /@nimiplatform\/kit\/ui/u);
  assert.match(mainSource, /NimiThemeProvider/u);
  assert.match(mainSource, /accentPack="nimi-accent"/u);
  assert.match(mainSource, /defaultScheme="light"/u);
});

test('desktop foundation imports shared foundation and accent packs only', () => {
  assert.match(foundationSource, /@nimiplatform\/kit\/ui\/styles\.css/u);
  assert.match(foundationSource, /@nimiplatform\/kit\/ui\/themes\/light\.css/u);
  assert.match(foundationSource, /@nimiplatform\/kit\/ui\/themes\/dark\.css/u);
  assert.match(foundationSource, /@nimiplatform\/kit\/ui\/themes\/nimi-accent\.css/u);
  assert.doesNotMatch(foundationSource, /relay-dark\.css|overtone-studio\.css/u);
  assert.doesNotMatch(stylesSource, /@import/u);
});

test('desktop stylesheet does not recreate shared token or primitive authority', () => {
  assert.match(stylesSource, /^@scope \(\.nimi-ui-module--desktop\) \{/u);
  assert.doesNotMatch(stylesSource, /(^|\n)\s*\.nimi-(?!ui-module--desktop\b)[^\n]*\{/u);
  assert.doesNotMatch(stylesSource, /--nimi-(?!ui-module-desktop-)[a-z0-9-]+\s*:/u);
  assert.doesNotMatch(stylesSource, /@theme\s*\{/u);
  assert.doesNotMatch(stylesSource, /--color-brand-|--color-accent-/u);
});
