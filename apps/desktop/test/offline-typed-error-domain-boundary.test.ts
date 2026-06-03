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

  assert.equal(fs.existsSync(offlineErrorsPath), false, 'Desktop must not retain offline typed-error forwarding shell');
  assert.doesNotMatch(offlineIndex, /createOfflineError|getErrorMessage|isRealmOfflineError|isRuntimeOfflineError|isNimiErrorLike/);
  assert.match(realmApi, /isRealmOfflineErrorLike as isRealmOfflineError/);
});

test('Offline app surface keeps cache, outbox, and coordinator exports separated', () => {
  const offlineIndex = read('apps/desktop/src/shell/renderer/infra/offline/index.ts');
  const cacheManager = read('apps/desktop/src/shell/renderer/infra/offline/cache-manager.ts');
  const outboxManager = read('apps/desktop/src/shell/renderer/infra/offline/outbox-manager.ts');

  assert.match(offlineIndex, /OfflineCoordinator/);
  assert.match(offlineIndex, /@nimiplatform\/kit\/core\/offline-coordinator/);
  assert.match(offlineIndex, /OfflineCacheManager/);
  assert.match(offlineIndex, /OfflineOutboxManager/);
  assert.doesNotMatch(cacheManager, /upsertChatOutboxEntry|getChatOutboxEntries|queueSocialMutation|markSocialMutation/);
  assert.doesNotMatch(cacheManager, /syncModelManifests|getCachedModelManifests|modelManifests/);
  assert.match(outboxManager, /upsertChatOutboxEntry/);
  assert.match(outboxManager, /queueSocialMutation/);
  assert.doesNotMatch(offlineIndex, /from '.\/errors\.js'/);
});

test('Offline cache database does not create a Runtime model manifest fallback store', () => {
  const offlineDatabase = read('apps/desktop/src/shell/renderer/infra/offline/database.ts');
  const discoverCommand = read('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-connector-discover-command.ts');

  assert.doesNotMatch(offlineDatabase, /model-manifests|OFFLINE_STORE_MODEL_MANIFESTS/);
  assert.doesNotMatch(discoverCommand, /syncModelManifests|getOfflineCacheManager|runtime_model_sync_failed_during_discovery/);
});
