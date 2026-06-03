import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopDir = resolve(import.meta.dirname, '..');
const repoDir = resolve(desktopDir, '../..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(resolve(desktopDir, relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoDir, relativePath), 'utf8');
}

test('external agent token ledger uses SDK Runtime projection instead of Tauri evidence', () => {
  const uiSource = readDesktopFile('src/shell/renderer/features/runtime-config/runtime-config-external-agent-access.tsx');

  assert.equal(existsSync(resolve(desktopDir, 'src/runtime/external-agent/index.ts')), false);
  assert.match(uiSource, /createHostRuntimeExternalAgentAccessSurface/);
  assert.match(uiSource, /from '@nimiplatform\/sdk\/runtime'/);
  assert.doesNotMatch(uiSource, /@runtime\/external-agent/);
  assert.doesNotMatch(uiSource, /tauriInvoke/);
  assert.doesNotMatch(uiSource, /external_agent_list_tokens/);
});

test('Runtime External Agent service fails closed while action registry is empty', () => {
  const serviceSource = readRepoFile('runtime/internal/services/externalagent/service.go');

  assert.match(serviceSource, /EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY/);
  assert.match(serviceSource, /Enabled:\s*false/);
  assert.match(serviceSource, /codes\.FailedPrecondition/);
  assert.doesNotMatch(serviceSource, /token_issuer/);
});
