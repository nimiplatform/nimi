import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Offline typed error preflight violation is migrated to SDK types', () => {
  const offlineErrorsPath = path.join(repoRoot, 'apps/desktop/src/shell/renderer/infra/offline/errors.ts');
  const offlineIndex = read('apps/desktop/src/shell/renderer/infra/offline/index.ts');
  const realmApi = read('apps/desktop/src/shell/renderer/infra/realm/realm-api.ts');
  const sdkTypes = read('sdk/src/types/index.ts');

  assert.equal(fs.existsSync(offlineErrorsPath), false, 'Desktop must not retain offline typed-error forwarding shell');
  assert.match(sdkTypes, /export function createOfflineNimiError/);
  assert.match(sdkTypes, /export function getNimiErrorMessage/);
  assert.match(sdkTypes, /export function classifyOfflineError/);
  assert.doesNotMatch(offlineIndex, /createOfflineError|getErrorMessage|isRealmOfflineError|isRuntimeOfflineError|isNimiErrorLike/);
  assert.match(realmApi, /isRealmOfflineErrorLike as isRealmOfflineError/);
});

test('Tester consumes SDK offline typed error helper as second app proof', () => {
  const testerSettings = read('apps/tester/src/shell/routes/settings.tsx');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(testerSettings, /createOfflineNimiError/);
  assert.match(testerSettings, /classifyOfflineError\(createOfflineNimiError\(/);
  assert.match(testerContract, /createOfflineNimiError/);
});

test('Offline app surface keeps only Desktop cache/coordinator exports', () => {
  const offlineIndex = read('apps/desktop/src/shell/renderer/infra/offline/index.ts');

  assert.match(offlineIndex, /OfflineCoordinator/);
  assert.match(offlineIndex, /@nimiplatform\/kit\/core\/offline-coordinator/);
  assert.match(offlineIndex, /OfflineCacheManager/);
  assert.doesNotMatch(offlineIndex, /from '.\/errors\.js'/);
});
