import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { verifyAgentCenterParity } from './lib/standard-shell-agent-center-parity.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

function source(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sources() {
  return {
    canonical: source('.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml'),
    typescriptCatalog: source('kit/shell/capabilities/src/catalog.ts'),
    rustCatalog: source('kit/shell/tauri/src/capabilities/catalog.rs'),
    rendererAliases: source('kit/shell/renderer/src/bridge/tauri-api.ts'),
    tauriRegistration: source('kit/shell/tauri/src/command_registration.rs'),
    electronHost: source('kit/shell/electron/src/main/agent-center.ts'),
  };
}

test('Agent Center parity covers canonical tuples and the actual Electron dispatcher', () => {
  assert.deepEqual(verifyAgentCenterParity(sources()), []);
});

test('removing an actual Electron dispatch branch fails parity', () => {
  const mutated = sources();
  mutated.electronHost = mutated.electronHost.replace(
    /^\s*\[NIMI_STANDARD_SHELL_COMMANDS\['agent-center\.backgroundRemove'\]\]:.*\n/mu,
    '',
  );
  assert.notEqual(mutated.electronHost, sources().electronHost, 'mutation must remove the runtime branch');
  assert.match(
    verifyAgentCenterParity(mutated).join('\n'),
    /Electron actual dispatch table: Agent Center parity drift/u,
  );
});
