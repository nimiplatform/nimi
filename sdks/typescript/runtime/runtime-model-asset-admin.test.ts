import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ModelAssetCatalogVerification,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  createNimiRuntimeLocalAssetAdminClient,
  type NimiRuntimeLocalAssetAdminRpc,
} from './runtime-local-asset-admin';

const modelAsset = {
  modelAssetId: 'model_01',
  contentId: `sha256:${'a'.repeat(64)}`,
  displayName: 'Community Model',
  entry: 'model.gguf',
  files: [{
    relativePath: 'model.gguf',
    sha256: 'a'.repeat(64),
    sizeBytes: '42',
    nonExecutableContent: false,
  }],
  totalSizeBytes: '42',
  contentVerified: true,
  catalogVerification: ModelAssetCatalogVerification.NOT_MATCHED,
  unclassified: true,
  boundedFingerprint: undefined,
  provenance: undefined,
  createdAt: '2026-08-14T00:00:00Z',
  updatedAt: '2026-08-14T00:00:00Z',
  latestIntegrityCheckedAt: '2026-08-14T00:00:00Z',
  duplicateContent: false,
  containsNonExecutableCode: false,
};

test('ModelAsset SDK uses the kind-free canonical Runtime CRUD surface', async () => {
  const calls: Array<{ method: string; request: unknown; options?: RuntimeTypedCallOptions }> = [];
  const rpc = {
    async importModelAsset(request: unknown, options?: RuntimeTypedCallOptions) {
      calls.push({ method: 'importModelAsset', request, options });
      return { transfer: { installSessionId: 'transfer_1', assetId: 'model_01', sessionKind: 'import', phase: 'staging', state: 'running', bytesReceived: '0', bytesTotal: '42', speedBytesPerSec: '0', etaSeconds: '0', message: '', reasonCode: '', retryable: false, createdAt: '', updatedAt: '' } };
    },
    async listModelAssets(request: unknown, options?: RuntimeTypedCallOptions) {
      calls.push({ method: 'listModelAssets', request, options });
      return { assets: [modelAsset], nextPageToken: '' };
    },
    async getModelAsset(request: unknown, options?: RuntimeTypedCallOptions) {
      calls.push({ method: 'getModelAsset', request, options });
      return { asset: modelAsset };
    },
    async removeModelAsset(request: { force: boolean }, options?: RuntimeTypedCallOptions) {
      calls.push({ method: 'removeModelAsset', request, options });
      return { asset: modelAsset, referencingLoadoutIds: ['loadout_1'], confirmationRequired: !request.force, cleanupPending: request.force };
    },
  } as unknown as NimiRuntimeLocalAssetAdminRpc;
  const client = createNimiRuntimeLocalAssetAdminClient({ local: rpc });
  assert.equal('importAssetFile' in client, false);
  assert.equal('importFile' in client, false);
  assert.equal('importBundle' in client, false);

  const transfer = await client.importModelAsset({ sourcePath: 'D:/models/community.gguf' }, { caller: 'core' });
  assert.equal(transfer.installSessionId, 'transfer_1');
  assert.deepEqual(calls[0]?.request, { sourcePath: 'D:/models/community.gguf', displayName: '' });
  assert.equal('kind' in (calls[0]?.request as Record<string, unknown>), false);
  assert.equal('engine' in (calls[0]?.request as Record<string, unknown>), false);

  const listed = await client.listModelAssets();
  assert.equal(listed[0]?.modelAssetId, 'model_01');
  assert.equal(listed[0]?.contentVerified, true);
  assert.equal(listed[0]?.catalogVerified, false);
  assert.equal(listed[0]?.unclassified, true);

  assert.equal((await client.getModelAsset('model_01')).contentId, modelAsset.contentId);
  const inspection = await client.inspectModelAssetRemoval('model_01');
  assert.equal(inspection.confirmationRequired, true);
  assert.deepEqual(inspection.referencingLoadoutIds, ['loadout_1']);
  const removed = await client.removeModelAsset('model_01', { caller: 'core' });
  assert.equal(removed.cleanupPending, true);
  assert.deepEqual(calls.filter((call) => call.method === 'removeModelAsset').map((call) => (call.request as { force: boolean }).force), [false, true]);
});
