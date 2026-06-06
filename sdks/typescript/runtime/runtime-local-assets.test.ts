import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalAssetKind,
  LocalAssetStatus,
  type ListLocalAssetsRequest,
  type LocalAssetRecord,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  NIMI_RUNTIME_LOCAL_ASSET_ENTRY_DEFAULT_PAGE_SIZE,
  listNimiRuntimeLocalAssetEntries,
  projectNimiRuntimeLocalAssetEntry,
} from './index';

test('Runtime local asset list projects generated records to UI-readable ids and pages through Runtime', async () => {
  const calls: {
    request: ListLocalAssetsRequest;
    options?: RuntimeTypedCallOptions;
  }[] = [];
  const callOptions = {
    metadata: { authorization: 'Bearer test' },
    timeoutMs: 1234,
  } satisfies RuntimeTypedCallOptions;
  const runtime = {
    local: {
      async listLocalAssets(
        request: ListLocalAssetsRequest,
        options?: RuntimeTypedCallOptions,
      ) {
        calls.push({ request, options });
        return calls.length === 1
          ? {
            assets: [
              localAssetRecord({
                localAssetId: ' local-chat ',
                assetId: ' chat-model ',
                kind: LocalAssetKind.CHAT,
                engine: ' llama ',
                status: LocalAssetStatus.ACTIVE,
              }),
            ],
            nextPageToken: ' next-page ',
          }
          : {
            assets: [
              localAssetRecord({
                localAssetId: 'local-vae',
                assetId: 'vae-model',
                kind: LocalAssetKind.VAE,
                engine: 'media',
                status: LocalAssetStatus.INSTALLED,
              }),
            ],
            nextPageToken: '',
          };
      },
    },
  };

  const assets = await listNimiRuntimeLocalAssetEntries(runtime, {
    kind: 'chat',
    status: 'active',
    engine: ' llama ',
    pageSize: 50,
    callOptions,
  });

  assert.deepEqual(assets, [
    {
      localAssetId: 'local-chat',
      assetId: 'chat-model',
      kind: 'chat',
      engine: 'llama',
      status: 'active',
    },
    {
      localAssetId: 'local-vae',
      assetId: 'vae-model',
      kind: 'vae',
      engine: 'media',
      status: 'installed',
    },
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.request, {
    statusFilter: LocalAssetStatus.ACTIVE,
    kindFilter: LocalAssetKind.CHAT,
    engineFilter: 'llama',
    pageSize: 50,
    pageToken: '',
  });
  assert.equal(calls[0]?.options, callOptions);
  assert.deepEqual(calls[1]?.request, {
    statusFilter: LocalAssetStatus.ACTIVE,
    kindFilter: LocalAssetKind.CHAT,
    engineFilter: 'llama',
    pageSize: 50,
    pageToken: 'next-page',
  });
});

test('Runtime local asset list defaults to unfiltered generated request values', async () => {
  const requests: ListLocalAssetsRequest[] = [];
  const runtime = {
    local: {
      async listLocalAssets(request: ListLocalAssetsRequest) {
        requests.push(request);
        return { assets: [], nextPageToken: '' };
      },
    },
  };

  await listNimiRuntimeLocalAssetEntries(runtime, { pageSize: -1 });

  assert.deepEqual(requests, [
    {
      statusFilter: LocalAssetStatus.UNSPECIFIED,
      kindFilter: LocalAssetKind.UNSPECIFIED,
      engineFilter: '',
      pageSize: NIMI_RUNTIME_LOCAL_ASSET_ENTRY_DEFAULT_PAGE_SIZE,
      pageToken: '',
    },
  ]);
});

test('Runtime local asset projection fails closed on invalid Runtime records', () => {
  assert.throws(
    () => projectNimiRuntimeLocalAssetEntry(localAssetRecord({ localAssetId: '' })),
    matchesNimiError('SDK_RUNTIME_LOCAL_ASSET_RESPONSE_INVALID'),
  );
  assert.throws(
    () => projectNimiRuntimeLocalAssetEntry(localAssetRecord({ kind: 999 as LocalAssetKind })),
    matchesNimiError('SDK_RUNTIME_LOCAL_ASSET_RESPONSE_INVALID'),
  );
  assert.throws(
    () => projectNimiRuntimeLocalAssetEntry(localAssetRecord({ status: 999 as LocalAssetStatus })),
    matchesNimiError('SDK_RUNTIME_LOCAL_ASSET_RESPONSE_INVALID'),
  );
});

function localAssetRecord(input: Partial<LocalAssetRecord> = {}): LocalAssetRecord {
  return {
    localAssetId: 'local-asset',
    assetId: 'asset',
    kind: LocalAssetKind.CHAT,
    engine: 'llama',
    status: LocalAssetStatus.ACTIVE,
    ...input,
  } as LocalAssetRecord;
}

function matchesNimiError(reasonCode: string) {
  return (error: unknown) => {
    assert.equal((error as { reasonCode?: string }).reasonCode, reasonCode);
    return true;
  };
}
