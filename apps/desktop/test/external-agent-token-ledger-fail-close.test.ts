import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const source = readDesktopFile('src/runtime/external-agent/index.ts');

  assert.match(source, /getPlatformClient\(\)\.runtime\.externalAgent\.listTokens/);
  assert.match(source, /projectExternalAgentTokenLedger/);
  assert.match(source, /projectExternalAgentIssueTokenResult/);
  assert.match(source, /projectExternalAgentGatewayStatus/);
  assert.match(source, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(source, /EXTERNAL_AGENT_TOKEN_LEDGER_INVALID_RESPONSE/);
  assert.doesNotMatch(source, /tauriInvoke/);
  assert.doesNotMatch(source, /external_agent_list_tokens/);
  assert.doesNotMatch(source, /function parseExternalAgentTokenRecord/);
  assert.doesNotMatch(source, /function toIsoFromTimestamp/);
});

test('Runtime External Agent service fails closed while action registry is empty', () => {
  const serviceSource = readRepoFile('runtime/internal/services/externalagent/service.go');

  assert.match(serviceSource, /EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY/);
  assert.match(serviceSource, /Enabled:\s*false/);
  assert.match(serviceSource, /codes\.FailedPrecondition/);
  assert.doesNotMatch(serviceSource, /token_issuer/);
});
