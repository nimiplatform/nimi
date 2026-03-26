import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(path.join(testDir, '..', 'src', 'renderer', 'main.tsx'), 'utf8');
const stylesSource = readFileSync(path.join(testDir, '..', 'src', 'renderer', 'styles.css'), 'utf8');

describe('relay design theme entry contract', () => {
  it('uses the shared Nimi theme provider with the relay accent pack', () => {
    assert.match(mainSource, /@nimiplatform\/nimi-kit\/ui/u);
    assert.match(mainSource, /NimiThemeProvider/u);
    assert.match(mainSource, /accentPack="relay-accent"/u);
    assert.match(mainSource, /defaultScheme="dark"/u);
  });

  it('imports the shared foundation and relay accent styles', () => {
    assert.match(stylesSource, /@nimiplatform\/nimi-kit\/ui\/styles\.css/u);
    assert.match(stylesSource, /@nimiplatform\/nimi-kit\/ui\/themes\/light\.css/u);
    assert.match(stylesSource, /@nimiplatform\/nimi-kit\/ui\/themes\/dark\.css/u);
    assert.match(stylesSource, /@nimiplatform\/nimi-kit\/ui\/themes\/relay-accent\.css/u);
    assert.doesNotMatch(stylesSource, /relay-dark\.css|overtone-studio\.css/u);
  });

  it('does not redefine shared primitive or token authority', () => {
    assert.doesNotMatch(stylesSource, /(^|\n)\s*\.nimi-[^\n]*\{/u);
    assert.doesNotMatch(stylesSource, /--nimi-[a-z0-9-]+\s*:/u);
    assert.doesNotMatch(stylesSource, /@theme\s*\{/u);
    assert.doesNotMatch(stylesSource, /--ot-[a-z0-9-]+|--color-ot-[a-z0-9-]+/u);
  });
});
