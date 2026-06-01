import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Network retry and API error normalization migrated to SDK types', () => {
  const sdkNetworkRetry = read('sdk/src/types/network-retry.ts');
  const desktopRetry = read('apps/desktop/src/runtime/net/request-with-retry.ts');
  const desktopNormalize = read('apps/desktop/src/runtime/net/error-normalize.ts');

  assert.match(sdkNetworkRetry, /export async function requestWithRetry/);
  assert.match(sdkNetworkRetry, /export function normalizeApiError/);
  assert.match(sdkNetworkRetry, /RETRYABLE_STATUS_CODES\s*=\s*new Set/);
  assert.match(desktopRetry, /from '@nimiplatform\/sdk\/types'/);
  assert.match(desktopNormalize, /from '@nimiplatform\/sdk\/types'/);

  assert.doesNotMatch(desktopRetry, /RETRYABLE_STATUS_CODES|Math\.pow|defaultSleepImpl|normalizeApiError\(error\)/);
  assert.doesNotMatch(desktopNormalize, /tryParseJsonLike|extractNimiErrorFields|function isApiErrorLike/);
});

test('Tester consumes SDK requestWithRetry as second app proof', () => {
  const workbench = read('apps/tester/src/tester/tester-workbench.tsx');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(workbench, /requestWithRetry/);
  assert.match(workbench, /from '@nimiplatform\/sdk\/types'/);
  assert.match(workbench, /executor:\s*loadTesterRunHistory/);
  assert.match(testerContract, /requestWithRetry/);
});
