import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

test('desktop managed OAuth adapter delegates acquisition truth to SDK', () => {
  const adapterSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-codex-oauth.ts',
  );

  assert.match(adapterSource, /acquireNimiManagedConnectorCredential/);
  assert.doesNotMatch(adapterSource, /CODEX_OAUTH_/);
  assert.doesNotMatch(adapterSource, /auth\.openai\.com/);
  assert.doesNotMatch(adapterSource, /deviceauth/);
  assert.doesNotMatch(adapterSource, /app_EMoamEEZ73f0CkXaXp7hrann/);
});

test('desktop cloud page lets SDK persist managed OAuth payload through Runtime connector writer', () => {
  const pageSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-cloud.tsx',
  );

  assert.match(pageSource, /runtime:\s*runtimeConnectors/);
  assert.match(pageSource, /connectorId:\s*selectedConnectorId/);
  assert.doesNotMatch(pageSource, /persistCredential/);
  assert.doesNotMatch(pageSource, /credentialJson:\s*credential\.credentialJson/);
  assert.doesNotMatch(pageSource, /acquired\.credentialJson/);
  assert.doesNotMatch(pageSource, /acquired\.accessToken/);
});
