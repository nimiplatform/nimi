import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rendererRoot = resolve(import.meta.dirname, '../src');
const capabilityRoot = resolve(import.meta.dirname, '../../capabilities/src');

describe('Runtime account broker renderer hardcut', () => {
  it('does not export or alias the retired auth session custody surface', () => {
    const bridgeIndex = readFileSync(resolve(rendererRoot, 'bridge/index.ts'), 'utf8');
    const tauriApi = readFileSync(resolve(rendererRoot, 'bridge/tauri-api.ts'), 'utf8');
    const bootstrapIndex = readFileSync(resolve(rendererRoot, 'bootstrap/index.ts'), 'utf8');
    const capabilityIndex = readFileSync(resolve(capabilityRoot, 'index.ts'), 'utf8');
    const capabilityCatalog = readFileSync(resolve(capabilityRoot, 'catalog.ts'), 'utf8');

    expect(bridgeIndex).not.toMatch(/loadAuthSession|saveAuthSession|clearAuthSession|watchAuthSessionChanges/u);
    expect(tauriApi).not.toMatch(/auth\.session(?:Load|Save|Clear)|auth_session_(?:load|save|clear)/u);
    expect(bootstrapIndex).not.toMatch(/BootstrapAuthSession|resolveBootstrapAuthSession|accessToken|refreshToken/u);
    expect(capabilityIndex).not.toContain("./auth.js");
    expect(capabilityCatalog).not.toMatch(/id: 'auth'|command: 'nimi\.shell\.auth\.session/u);
  });
});
