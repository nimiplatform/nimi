import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listRuntimeLocalAssetEntries,
  projectRuntimeLocalAssetEntry,
} from '../../src/runtime/index.js';

test('Runtime local asset entry projection normalizes proto enum strings for app consumers', () => {
  assert.deepEqual(projectRuntimeLocalAssetEntry({
    localAssetId: ' local-1 ',
    assetId: ' asset-1 ',
    kind: 'LOCAL_ASSET_KIND_CHAT',
    engine: ' llama ',
    status: 'LOCAL_ASSET_STATUS_INSTALLED',
  }), {
    localAssetId: 'local-1',
    assetId: 'asset-1',
    kind: 1,
    engine: 'llama',
    status: 1,
  });
});

test('Runtime local asset list helper pages through Runtime without app-owned DTO construction', async () => {
  const requests: unknown[] = [];
  const assets = await listRuntimeLocalAssetEntries({
    local: {
      async listLocalAssets(request) {
        requests.push(request);
        return {
          assets: [{
            localAssetId: `local-${requests.length}`,
            assetId: `asset-${requests.length}`,
            kind: requests.length === 1 ? 'LOCAL_ASSET_KIND_IMAGE' : 10,
            engine: 'media',
            status: requests.length === 1 ? 'LOCAL_ASSET_STATUS_ACTIVE' : 4,
          }],
          nextPageToken: requests.length === 1 ? 'next' : '',
        };
      },
    },
  }, { pageSize: 1 });

  assert.deepEqual(requests, [{
    statusFilter: 0,
    kindFilter: 0,
    engineFilter: '',
    pageSize: 1,
    pageToken: '',
  }, {
    statusFilter: 0,
    kindFilter: 0,
    engineFilter: '',
    pageSize: 1,
    pageToken: 'next',
  }]);
  assert.deepEqual(assets, [{
    localAssetId: 'local-1',
    assetId: 'asset-1',
    kind: 2,
    engine: 'media',
    status: 2,
  }, {
    localAssetId: 'local-2',
    assetId: 'asset-2',
    kind: 10,
    engine: 'media',
    status: 4,
  }]);
});
