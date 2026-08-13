import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  toNimiRuntimeProtoStruct,
} from './index';

test('Runtime local asset list projects generated records to UI-readable ids and pages through Runtime', async () => {
  const calls: {
    request: ListLocalAssetsRequest;
    options?: RuntimeTypedCallOptions;
  }[] = [];
  const callOptions = {
    metadata: { 'x-nimi-access-token-id': 'test-token-id' },
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

test('Runtime local asset projection does not synthesize assetId from localAssetId', () => {
  const projected = projectNimiRuntimeLocalAssetEntry(localAssetRecord({
    localAssetId: 'local-record-1',
    assetId: '',
  }));

  assert.deepEqual(projected, {
    localAssetId: 'local-record-1',
    assetId: '',
    kind: 'chat',
    engine: 'llama',
    status: 'active',
  });
});

test('Runtime local asset projection preserves model family and metadata', () => {
  const projected = projectNimiRuntimeLocalAssetEntry(localAssetRecord({
    localAssetId: 'local-image',
    assetId: 'local-import/ideogram4-Q4_0',
    kind: LocalAssetKind.IMAGE,
    family: ' ideogram4 ',
    metadata: toNimiRuntimeProtoStruct({
      modelFamily: 'ideogram4',
      source: 'selected-source',
    }),
  }));

  assert.deepEqual(projected, {
    localAssetId: 'local-image',
    assetId: 'local-import/ideogram4-Q4_0',
    kind: 'image',
    engine: 'llama',
    status: 'active',
    family: 'ideogram4',
    metadata: {
      modelFamily: 'ideogram4',
      source: 'selected-source',
    },
  });
});

test('Runtime local asset projection preserves artifact roles for companion dependency pickers', () => {
  const projected = projectNimiRuntimeLocalAssetEntry(localAssetRecord({
    localAssetId: 'local-uncond',
    assetId: 'local-import/ideogram4_uncond-Q4_0',
    kind: LocalAssetKind.IMAGE,
    engine: ' media ',
    status: LocalAssetStatus.INSTALLED,
    artifactRoles: [' uncond_diffusion_model ', '', ' auxiliary '],
  }));

  assert.deepEqual(projected, {
    localAssetId: 'local-uncond',
    assetId: 'local-import/ideogram4_uncond-Q4_0',
    kind: 'image',
    engine: 'media',
    status: 'installed',
    artifactRoles: ['uncond_diffusion_model', 'auxiliary'],
  });
});

test('Runtime local asset projection exposes only the exact entry integrity fact', () => {
  const projected = projectNimiRuntimeLocalAssetEntry(localAssetRecord({
    entry: 'model.gguf',
    hashes: {
      'model.gguf': `SHA256:${'A'.repeat(64)}`,
      'other.gguf': `sha256:${'b'.repeat(64)}`,
    },
  }));
  assert.equal(projected.expectedVerifiedContentId, `sha256:${'a'.repeat(64)}`);
  assert.deepEqual(projected.exactContent, {
    kind: 'single-file',
    verifiedContentId: `sha256:${'a'.repeat(64)}`,
    entrySha256: 'a'.repeat(64),
  });

  const missingExactEntryHash = projectNimiRuntimeLocalAssetEntry(localAssetRecord({
    entry: 'model.gguf',
    hashes: { 'other.gguf': `sha256:${'b'.repeat(64)}` },
  }));
  assert.equal(missingExactEntryHash.expectedVerifiedContentId, undefined);
});

test('Runtime local asset projection preserves one canonical exact-binding fact for an ordered bundle', () => {
  const first = 'a'.repeat(64);
  const second = 'b'.repeat(64);
  const canonicalBundleDigest = createHash('sha256')
    .update(Buffer.concat([Buffer.from(first, 'hex'), Buffer.from(second, 'hex')]))
    .digest('hex');
  const projected = projectNimiRuntimeLocalAssetEntry(localAssetRecord({
    localAssetId: 'local-sharded-image',
    entry: 'model-00001-of-00002.gguf',
    files: ['model-00001-of-00002.gguf', 'model-00002-of-00002.gguf'],
    hashes: {
      'model-00001-of-00002.gguf': first,
      'model-00002-of-00002.gguf': second,
    },
    bundleEntries: [
      { ordinal: 1, relativePath: 'model-00001-of-00002.gguf', sha256: first },
      { ordinal: 2, relativePath: 'model-00002-of-00002.gguf', sha256: second },
    ],
  }));

  assert.equal(projected.expectedVerifiedContentId, `sha256:${canonicalBundleDigest}`);
  assert.deepEqual(projected.exactContent, {
    kind: 'sharded-bundle',
    verifiedContentId: `sha256:${canonicalBundleDigest}`,
    entrySha256: canonicalBundleDigest,
    bundleEntries: [
      { ordinal: 1, relativePath: 'model-00001-of-00002.gguf', sha256: first },
      { ordinal: 2, relativePath: 'model-00002-of-00002.gguf', sha256: second },
    ],
  });
  assert.equal(projected.bundleEntries?.length, 2);
});

test('Runtime local asset projection preserves public display identity without execution bindings', () => {
  const publicIdentity = `nimi/component/vae/sha256-${'a'.repeat(64)}`;
  const projected = projectNimiRuntimeLocalAssetEntry(localAssetRecord({
    localAssetId: 'private-runtime-vae-record',
    assetId: 'local-import/z-image-vae/machine-instance',
    logicalModelId: '',
    displayName: 'Z Image VAE',
    sourceFileName: 'z-image-vae.safetensors',
    kind: LocalAssetKind.VAE,
    status: LocalAssetStatus.INSTALLED,
    metadata: toNimiRuntimeProtoStruct({
      effectivePublicComponentIdentity: publicIdentity,
    }),
  }));

  assert.equal(projected.logicalModelId, publicIdentity);
  assert.equal(projected.displayName, 'Z Image VAE');
  assert.equal(projected.sourceFileName, 'z-image-vae.safetensors');
  assert.notEqual(projected.logicalModelId, projected.localAssetId);
  assert.notEqual(projected.logicalModelId, projected.assetId);
  assert.equal(projected.kind, 'vae');
  assert.equal(projected.status, 'installed');
  assert.equal('durableTargetRef' in projected, false);
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
