import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(testDir, 'main.tsx'), 'utf8');
const stylesSource = fs.readFileSync(path.join(testDir, 'styles.css'), 'utf8');

describe('forge design theme entry contract', () => {
  it('uses the shared Nimi theme provider with the forge accent pack', () => {
    expect(mainSource).toMatch(/@nimiplatform\/nimi-kit\/ui/);
    expect(mainSource).toMatch(/NimiThemeProvider/);
    expect(mainSource).toMatch(/accentPack="forge-accent"/);
    expect(mainSource).toMatch(/defaultScheme="light"/);
  });

  it('imports the shared foundation and forge accent styles', () => {
    expect(stylesSource).toMatch(/@nimiplatform\/nimi-kit\/ui\/styles\.css/);
    expect(stylesSource).toMatch(/@nimiplatform\/nimi-kit\/ui\/themes\/light\.css/);
    expect(stylesSource).toMatch(/@nimiplatform\/nimi-kit\/ui\/themes\/dark\.css/);
    expect(stylesSource).toMatch(/@nimiplatform\/nimi-kit\/ui\/themes\/forge-accent\.css/);
    expect(stylesSource).not.toMatch(/relay-dark\.css|overtone-studio\.css/);
  });

  it('does not redefine shared primitive or token authority', () => {
    expect(stylesSource).not.toMatch(/(^|\n)\s*\.nimi-[^\n]*\{/u);
    expect(stylesSource).not.toMatch(/--nimi-[a-z0-9-]+\s*:/u);
    expect(stylesSource).not.toMatch(/@theme\s*\{/u);
    expect(stylesSource).not.toMatch(/--ot-[a-z0-9-]+|--color-ot-[a-z0-9-]+/u);
  });
});
