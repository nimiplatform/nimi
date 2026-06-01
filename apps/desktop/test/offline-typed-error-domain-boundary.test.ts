import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Offline typed error preflight violation is migrated to SDK types', () => {
  const desktopOfflineErrors = read('apps/desktop/src/shell/renderer/infra/offline/errors.ts');
  const sdkTypes = read('sdk/src/types/index.ts');

  assert.match(sdkTypes, /export function createOfflineNimiError/);
  assert.match(desktopOfflineErrors, /createOfflineNimiError/);
  assert.match(desktopOfflineErrors, /classifyOfflineError/);

  assert.doesNotMatch(desktopOfflineErrors, /createNimiError/);
  assert.doesNotMatch(desktopOfflineErrors, /createNimiClientId/);
  assert.doesNotMatch(desktopOfflineErrors, /randomTraceId/);
  assert.doesNotMatch(desktopOfflineErrors, /REALM_OFFLINE_REASON_CODES|RUNTIME_OFFLINE_REASON_CODES/);
});

test('Tester consumes SDK offline typed error helper as second app proof', () => {
  const testerSettings = read('apps/tester/src/shell/routes/settings.tsx');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(testerSettings, /createOfflineNimiError/);
  assert.match(testerSettings, /classifyOfflineError\(createOfflineNimiError\(/);
  assert.match(testerContract, /createOfflineNimiError/);
});

test('Offline app surface keeps only thin Desktop aliases over SDK classification', () => {
  const offlineIndex = read('apps/desktop/src/shell/renderer/infra/offline/index.ts');
  const offlineErrors = read('apps/desktop/src/shell/renderer/infra/offline/errors.ts');

  assert.match(offlineIndex, /OfflineCoordinator/);
  assert.match(offlineIndex, /@nimiplatform\/kit\/core\/offline-coordinator/);
  assert.match(offlineErrors, /export function isRealmOfflineError/);
  assert.match(offlineErrors, /export function isRuntimeOfflineError/);
  assert.match(offlineErrors, /classifyOfflineError\(error, \{ transportOwner: 'realm' \}\)/);
  assert.match(offlineErrors, /classifyOfflineError\(error, \{ transportOwner: 'runtime' \}\)/);
});
