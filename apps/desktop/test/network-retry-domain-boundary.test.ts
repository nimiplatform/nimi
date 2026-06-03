import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Network retry and API error normalization migrated to SDK types', () => {
  const realmApi = read('apps/desktop/src/shell/renderer/infra/realm/realm-api.ts');

  assert.match(realmApi, /normalizeApiError/);
  assert.match(realmApi, /from '@nimiplatform\/sdk\/types'/);

  assert.equal(fs.existsSync(path.join(repoRoot, 'apps/desktop/src/runtime/net/request-with-retry.ts')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'apps/desktop/src/runtime/net/error-normalize.ts')), false);
  assert.doesNotMatch(realmApi, /@runtime\/net/);
});

test('Tester consumes SDK requestWithRetry as second app proof', () => {
  const workbench = read('apps/tester/src/tester/tester-workbench.tsx');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(workbench, /requestWithRetry/);
  assert.match(workbench, /from '@nimiplatform\/sdk\/types'/);
  assert.match(workbench, /executor:\s*loadTesterRunHistory/);
  assert.match(testerContract, /requestWithRetry/);
});
