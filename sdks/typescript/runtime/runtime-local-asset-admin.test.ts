import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalAssetKind,
  LocalAssetStatus,
  LocalEngineRuntimeMode,
  LocalRecommendationFeedCacheState,
  LocalRecommendationFeedCapability,
  LocalRecommendationFeedSource,
  LocalRecommendationFormat,
  LocalRecommendationSource,
  LocalRecommendationTier,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS,
  applyNimiRuntimeLocalRecommendationFeedFilters,
  buildNimiRuntimeLocalImageNativeEnvironmentPlanInput,
  buildNimiRuntimeLocalQwen3ASREnvironmentPlanInput,
  buildNimiRuntimeLocalQwen3ASRTransformersEnvironmentPlanInput,
  buildNimiRuntimeLocalQwen3TTSEnvironmentPlanInput,
  collectNimiRuntimeLocalRecommendationFeedLicenses,
  collectNimiRuntimeLocalRecommendationFeedProviders,
  createNimiRuntimeLocalAssetAdminClient,
  filterNimiRuntimeLocalRecommendationFeedItems,
  formatNimiRuntimeLocalRecommendationQuantQualityLabel,
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  isNimiRuntimeLocalEnvironmentDependencyJobRetryableState,
  isNimiRuntimeLocalEnvironmentDependencyJobTransferringState,
  isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState,
  isNimiRuntimeLocalEnvironmentDependencyStartableState,
  isNimiRuntimeLocalEnvironmentDependencyUnsupportedState,
  parseNimiRuntimeLocalRecommendationFeedCapabilityId,
  parseNimiRuntimeLocalRecommendationLicenseShort,
  parseNimiRuntimeLocalRecommendationParamsFromTitle,
  parseNimiRuntimeLocalRecommendationQuantBitsFromEntry,
  parseNimiRuntimeLocalRecommendationQuantLevelFromEntry,
  projectNimiRuntimeLocalAssetRecord,
  projectNimiRuntimeLocalCatalogItemDescriptor,
  projectNimiRuntimeLocalCatalogVariantDescriptor,
  projectNimiRuntimeLocalDeviceProfile,
  projectNimiRuntimeLocalEnvironmentDependencyJob,
  projectNimiRuntimeLocalRecommendationFeed,
  resolveNimiRuntimeLocalImageNativeEnvironmentPlan,
  type NimiRuntimeLocalRecommendationFeedItem,
  type NimiRuntimeLocalAssetAdminRpc,
  type NimiRuntimeLocalProfileDescriptor,
} from './index';
import { ReasonCode as SdkReasonCode } from '../types';

test('Runtime local model center client pages, dedupes, and projects generated local assets', async () => {
  const calls: unknown[] = [];
  const client = createNimiRuntimeLocalAssetAdminClient({
    local: {
      ...emptyLocalRpc(),
      async listLocalAssets(request, options) {
        calls.push({ request, options });
        return calls.length === 1
          ? {
            assets: [
              generatedAsset({
                localAssetId: 'local-1',
                assetId: 'llama/chat-model',
                kind: LocalAssetKind.CHAT,
                status: LocalAssetStatus.ACTIVE,
                capabilities: ['text.embed'],
              }),
            ],
            nextPageToken: 'page-2',
          }
          : {
            assets: [
              generatedAsset({
                localAssetId: 'local-duplicate',
                assetId: 'local/chat-model',
                kind: LocalAssetKind.CHAT,
                status: LocalAssetStatus.INSTALLED,
              }),
              generatedAsset({
                localAssetId: 'local-image',
                assetId: 'media/image-model',
                kind: LocalAssetKind.IMAGE,
                status: LocalAssetStatus.INSTALLED,
              }),
            ],
            nextPageToken: '',
          };
      },
    },
    callOptions: { metadata: { 'x-nimi-access-token-id': 'local-token-id' } },
  });

  const assets = await client.listAssets({ kind: 'chat', status: 'active', engine: 'llama', pageSize: 50 });

  assert.deepEqual(calls, [
    {
      request: {
        statusFilter: LocalAssetStatus.ACTIVE,
        kindFilter: LocalAssetKind.CHAT,
        engineFilter: 'llama',
        pageSize: 50,
        pageToken: '',
      },
      options: { metadata: { 'x-nimi-access-token-id': 'local-token-id' } },
    },
    {
      request: {
        statusFilter: LocalAssetStatus.ACTIVE,
        kindFilter: LocalAssetKind.CHAT,
        engineFilter: 'llama',
        pageSize: 50,
        pageToken: 'page-2',
      },
      options: { metadata: { 'x-nimi-access-token-id': 'local-token-id' } },
    },
  ]);
  assert.deepEqual(assets.map((asset) => ({
    localAssetId: asset.localAssetId,
    assetId: asset.assetId,
    kind: asset.kind,
    status: asset.status,
  })), [
    {
      localAssetId: 'local-1',
      assetId: 'local/chat-model',
      kind: 'embedding',
      status: 'active',
    },
    {
      localAssetId: 'local-image',
      assetId: 'local/image-model',
      kind: 'image',
      status: 'installed',
    },
  ]);
});

test('Runtime local asset projection carries display identity facts', async () => {
  const client = createNimiRuntimeLocalAssetAdminClient({
    local: {
      ...emptyLocalRpc(),
      async listLocalAssets() {
        return {
          assets: [
            generatedAsset({
              localAssetId: 'local-tts',
              assetId: 'local/local-import/qwen3-tts/01KZFPYNCX823S5KY9X57XN8JZ', // pragma: allowlist secret
              displayName: 'Qwen3 TTS',
              sourceFileName: 'qwen3-tts.gguf',
            }),
          ],
          nextPageToken: '',
        };
      },
    },
  });

  const [asset] = await client.listAssets();
  assert.equal(asset?.displayName, 'Qwen3 TTS');
  assert.equal(asset?.sourceFileName, 'qwen3-tts.gguf');

  const legacy = projectNimiRuntimeLocalAssetRecord(generatedAsset({ localAssetId: 'local-legacy' }));
  assert.equal(legacy.displayName, '');
  assert.equal(legacy.sourceFileName, '');
});

test('Runtime local model center write path fails closed for non-core callers', async () => {
  const client = createNimiRuntimeLocalAssetAdminClient({
    local: emptyLocalRpc(),
  });

  await assert.rejects(
    client.remove('local-1'),
    (error: unknown) => {
      const record = error as { reasonCode?: string; details?: { caller?: string } };
      assert.equal(record.reasonCode, 'SDK_RUNTIME_LOCAL_WRITE_DENIED');
      assert.equal(record.details?.caller, '<missing>');
      return true;
    },
  );
  await assert.rejects(
    client.remove('local-1', { caller: 'renderer' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_LOCAL_WRITE_DENIED');
      return true;
    },
  );
  await assert.rejects(
    () => client.startEnvironmentDependencyJob({
      environmentKey: 'env-1',
      dependencyFamily: 'image-native',
      dependencyId: 'stable-diffusion.cpp',
      sourceKind: 'managed',
      confirmed: true,
      consumerScope: '',
    }, { caller: 'core' }),
    (error: unknown) => {
      const record = error as { reasonCode?: string; actionHint?: string };
      assert.equal(record.reasonCode, 'SDK_RUNTIME_LOCAL_INPUT_INVALID');
      assert.equal(record.actionHint, 'provide_local_dependency_consumer_scope');
      return true;
    },
  );
  await assert.rejects(
    () => client.repairEnvironmentDependency({
      environmentKey: 'env-1',
      dependencyFamily: 'image-native',
      dependencyId: 'stable-diffusion.cpp',
      confirmed: true,
      consumerScope: '',
    }, { caller: 'core' }),
    (error: unknown) => {
      const record = error as { reasonCode?: string; actionHint?: string };
      assert.equal(record.reasonCode, 'SDK_RUNTIME_LOCAL_INPUT_INVALID');
      assert.equal(record.actionHint, 'provide_local_dependency_consumer_scope');
      return true;
    },
  );
});

test('Runtime local recommendation projection normalizes generated numeric enum values', () => {
  const feed = projectNimiRuntimeLocalRecommendationFeed({
    deviceProfile: {
      os: 'darwin',
      arch: 'arm64',
      totalRamBytes: '1',
      availableRamBytes: '1',
      diskFreeBytes: '1',
      ports: [],
    },
    activeCapability: LocalRecommendationFeedCapability.IMAGE,
    generatedAt: '2026-06-05T00:00:00.000Z',
    cacheState: LocalRecommendationFeedCacheState.FRESH,
    items: [{
      itemId: 'item-1',
      source: LocalRecommendationFeedSource.MODEL_INDEX,
      repo: 'owner/model',
      revision: 'main',
      title: 'Model',
      description: 'Image model',
      capabilities: ['image'],
      tags: ['recommended'],
      formats: [LocalRecommendationFormat.GGUF],
      downloads: '10',
      likes: '2',
      lastModified: '2026-06-05T00:00:00.000Z',
      preferredEngine: 'media',
      verified: true,
      entries: [{
        entryId: 'q4',
        format: LocalRecommendationFormat.GGUF,
        entry: 'model.gguf',
        files: ['model.gguf'],
        totalSizeBytes: '1024',
        sha256: 'abc',
      }],
      recommendation: {
        source: LocalRecommendationSource.MEDIA_FIT,
        format: LocalRecommendationFormat.GGUF,
        tier: LocalRecommendationTier.RECOMMENDED,
        hostSupportClass: 1,
        confidence: 1,
        reasonCodes: ['memory_headroom_recommended'],
        recommendedEntry: 'model.gguf',
        fallbackEntries: [],
        suggestedAssets: [],
        suggestedNotes: [],
        baseline: 1,
      },
      installedState: {
        installed: false,
        localAssetId: '',
        status: LocalAssetStatus.UNSPECIFIED,
      },
      actionState: {
        canReviewInstallPlan: true,
        canOpenVariants: true,
        canOpenLocalAsset: false,
      },
      installPayload: {
        modelId: 'local/model',
        kind: LocalAssetKind.IMAGE,
        repo: 'owner/model',
        revision: 'main',
        capabilities: ['image'],
        engine: 'media',
        entry: 'model.gguf',
        files: ['model.gguf'],
        license: 'apache-2.0',
        hashes: {},
        endpoint: '',
      },
    }],
  }, (profile) => profile);

  assert.equal(feed.activeCapability, 'image');
  assert.equal(feed.cacheState, 'fresh');
  assert.equal(feed.items[0]?.source, 'model-index');
  assert.equal(feed.items[0]?.formats[0], 'gguf');
  assert.equal(feed.items[0]?.recommendation?.source, 'media-fit');
  assert.equal(feed.items[0]?.recommendation?.tier, 'recommended');
  assert.equal(feed.items[0]?.recommendation?.hostSupportClass, 'supported_supervised');
  assert.equal(feed.items[0]?.installPayload.kind, 'image');
});

test('Runtime local recommendation view helpers preserve feed order while filtering metadata', () => {
  const items = [
    recommendationFeedItem({
      itemId: 'tight',
      title: 'Image 7B Q4_K_M',
      repo: 'stability-ai/image',
      tier: 'tight',
      downloads: 30,
      likes: 4,
      license: 'CreativeML OpenRAIL-M',
      entry: 'image.Q4_K_M.gguf',
      totalSizeBytes: 20,
    }),
    recommendationFeedItem({
      itemId: 'recommended',
      title: 'Image 7B Q8_0',
      repo: 'nimi-platform/image',
      tier: 'recommended',
      downloads: 20,
      likes: 9,
      license: 'Apache-2.0',
      entry: 'image.Q8_0.gguf',
      totalSizeBytes: 40,
    }),
    recommendationFeedItem({
      itemId: 'installed',
      title: 'Image 3B Q5_K_M',
      repo: 'nimi-platform/installed',
      tier: 'runnable',
      downloads: 10,
      likes: 1,
      license: 'MIT',
      entry: 'installed.Q5_K_M.gguf',
      installed: true,
      totalSizeBytes: 10,
    }),
  ];

  assert.deepEqual(NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS, ['chat', 'image', 'video']);
  assert.equal(parseNimiRuntimeLocalRecommendationFeedCapabilityId('bad-value'), undefined);
  assert.equal(parseNimiRuntimeLocalRecommendationFeedCapabilityId('video'), 'video');
  assert.deepEqual(
    filterNimiRuntimeLocalRecommendationFeedItems(items, 'Q4').map((item) => item.itemId),
    ['tight'],
  );
  assert.deepEqual(
    applyNimiRuntimeLocalRecommendationFeedFilters(items, {}).map((item) => item.itemId),
    ['tight', 'recommended', 'installed'],
  );
  assert.deepEqual(
    applyNimiRuntimeLocalRecommendationFeedFilters(items, {
      providers: new Set(['Stability Ai']),
      licenses: new Set(['CreativeML']),
    }).map((item) => item.itemId),
    ['tight'],
  );
  assert.deepEqual(collectNimiRuntimeLocalRecommendationFeedProviders(items), ['Nimi Platform', 'Stability Ai']);
  assert.deepEqual(collectNimiRuntimeLocalRecommendationFeedLicenses(items), ['Apache 2.0', 'CreativeML', 'MIT']);
  assert.equal(parseNimiRuntimeLocalRecommendationParamsFromTitle('Image 7B Q4'), '7B');
  assert.equal(parseNimiRuntimeLocalRecommendationLicenseShort('Apache-2.0 license'), 'Apache 2.0');
  assert.equal(parseNimiRuntimeLocalRecommendationQuantLevelFromEntry('image.Q4_K_M.gguf'), 'Q4_K_M');
  assert.equal(parseNimiRuntimeLocalRecommendationQuantBitsFromEntry('image.Q4_K_M.gguf'), 4);
  assert.equal(formatNimiRuntimeLocalRecommendationQuantQualityLabel(4), 'Medium');
});

test('Runtime local catalog projection does not expose generated enum numbers to UI fields', () => {
  const item = projectNimiRuntimeLocalCatalogItemDescriptor({
    itemId: 'catalog-1',
    source: 'verified',
    title: 'Catalog item',
    description: 'Catalog item',
    modelId: 'local/catalog',
    repo: 'owner/catalog',
    revision: 'main',
    templateId: 'verified.catalog',
    capabilities: ['image.generate'],
    engine: 'media',
    engineRuntimeMode: LocalEngineRuntimeMode.SUPERVISED,
    installKind: 'download',
    installAvailable: true,
    endpoint: '',
    entry: 'model.gguf',
    files: ['model.gguf'],
    license: 'apache-2.0',
    hashes: {},
    tags: [],
    downloads: '0',
    likes: '0',
    lastModified: '',
    verified: true,
  } as Parameters<typeof projectNimiRuntimeLocalCatalogItemDescriptor>[0]);

  assert.equal(item.engineRuntimeMode, 'supervised');
  assert.equal(typeof item.engineRuntimeMode, 'string');
  assert.equal(item.tags.includes('image'), true);
});

test('Runtime local catalog variant projection preserves optional recommendation evidence', () => {
  const variant = projectNimiRuntimeLocalCatalogVariantDescriptor({
    filename: 'model.Q4_K_M.gguf',
    entry: 'model.Q4_K_M.gguf',
    files: ['model.Q4_K_M.gguf'],
    format: 'gguf',
    sizeBytes: '1024',
    sha256: 'abc',
    recommendation: {
      source: LocalRecommendationSource.MEDIA_FIT,
      format: LocalRecommendationFormat.GGUF,
      tier: LocalRecommendationTier.RECOMMENDED,
      hostSupportClass: 1,
      confidence: 1,
      reasonCodes: ['memory_headroom_recommended'],
      recommendedEntry: 'model.Q4_K_M.gguf',
      fallbackEntries: [],
      suggestedAssets: [],
      suggestedNotes: [],
      baseline: 1,
    },
  } as Parameters<typeof projectNimiRuntimeLocalCatalogVariantDescriptor>[0]);

  assert.equal(variant.recommendation?.source, 'media-fit');
  assert.equal(variant.recommendation?.tier, 'recommended');
  assert.equal(variant.recommendation?.recommendedEntry, 'model.Q4_K_M.gguf');
});

test('Runtime local environment dependency helpers normalize generated Runtime state semantics', () => {
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyReadyState('ready_system'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyReadyState('READY_MANAGED'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyStartableState('needs_confirmation'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState('needs_confirmation'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState('repair_required'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyUnsupportedState('unsupported'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobActiveState('installing'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobTransferringState('verifying'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobRetryableState('failed'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobFailedState('failed'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobCancelledState('cancelled'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobActiveState('ready_system'), false);
});

test('Qwen3 ASR environment helper preserves exact speech plan identity', () => {
  assert.deepEqual(buildNimiRuntimeLocalQwen3ASREnvironmentPlanInput({
    localAssetId: 'local-asr-1',
  }), {
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-asr.python',
    localAssetId: 'local-asr-1',
    assetId: undefined,
  });
});

test('Transformers-native Qwen3 ASR environment helper preserves its separate package-set identity', () => {
  assert.deepEqual(buildNimiRuntimeLocalQwen3ASRTransformersEnvironmentPlanInput({
    localAssetId: 'local-asr-transformers-1',
  }), {
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-asr-transformers.python',
    localAssetId: 'local-asr-transformers-1',
    assetId: undefined,
  });
});

test('Qwen3 TTS environment helper preserves exact speech plan identity', () => {
  assert.deepEqual(buildNimiRuntimeLocalQwen3TTSEnvironmentPlanInput({
    localAssetId: 'local-tts-1',
  }), {
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-tts.python',
    localAssetId: 'local-tts-1',
    assetId: undefined,
  });
});

test('Runtime local environment dependency job projection preserves Runtime-owned progress evidence', () => {
  const job = projectNimiRuntimeLocalEnvironmentDependencyJob({
    jobId: 'job-1',
    environmentKey: 'env-1',
    dependencyFamily: 'image-native',
    dependencyId: 'stable-diffusion.cpp',
    state: 'downloading',
    sourceKind: 'managed',
    canonicalRoot: '/runtime/deps',
    selectedSourceRecordId: 'source-1',
    failureDetail: '',
    retryable: false,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:01:00.000Z',
    bytesReceived: '1024',
    bytesTotal: '4096',
    percent: 25,
    speedBytesPerSec: '512',
    etaSeconds: '6',
    reasonCode: '',
    recoveryDisposition: 'continue',
  });

  assert.deepEqual({
    jobId: job.jobId,
    state: job.state,
    bytesReceived: job.bytesReceived,
    bytesTotal: job.bytesTotal,
    percent: job.percent,
    speedBytesPerSec: job.speedBytesPerSec,
    etaSeconds: job.etaSeconds,
    recoveryDisposition: job.recoveryDisposition,
  }, {
    jobId: 'job-1',
    state: 'downloading',
    bytesReceived: 1024,
    bytesTotal: 4096,
    percent: 25,
    speedBytesPerSec: 512,
    etaSeconds: 6,
    recoveryDisposition: 'continue',
  });
});

test('Runtime local image native environment helper delegates environment selection to Runtime', async () => {
  const planInput = buildNimiRuntimeLocalImageNativeEnvironmentPlanInput(
    { assetId: 'asset/image', localAssetId: 'local-image' },
  );
  assert.deepEqual(planInput, {
    packId: 'local-image-native',
    assetId: 'asset/image',
    localAssetId: 'local-image',
  });

  const calls: unknown[] = [];
  const plan = await resolveNimiRuntimeLocalImageNativeEnvironmentPlan({
    runtime: {
      async resolveEnvironmentPlan(input) {
        calls.push(input);
        return {
          planId: 'plan-1',
          packId: input.packId,
          productLabel: 'Local image native runtime',
          hostProfileId: 'host-1',
          platformTuple: 'linux-x64',
          runtimeDataRoot: '',
          consumerScope: 'stable-diffusion.cpp.cuda',
          cloudOnlyImpact: '',
          state: 'ready_system',
          dependencies: [],
          requiredDependencyFamilies: ['native-engine-package.stablediffusion-ggml'],
          aggregateSizeKnown: true,
          aggregateSizeBytes: 0,
          storageCategories: ['environments'],
          sourceOwners: ['RuntimeLocalService'],
          noSystemMutation: true,
        };
      },
    },
    asset: { assetId: 'asset/image' },
  });

  assert.deepEqual(calls, [{
    packId: 'local-image-native',
    assetId: 'asset/image',
    localAssetId: undefined,
  }]);
  assert.equal(plan.consumerScope, 'stable-diffusion.cpp.cuda');
});

test('Runtime local model center client maps catalog, writes, transfers, profiles, and environment operations', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: unknown }> = [];
  const callOptions = { metadata: { 'x-nimi-access-token-id': 'local-token-id' } };
  const writeOptions = { caller: 'core' as const, callOptions: { timeoutMs: 10 } };
  const asset = generatedAsset({
    localAssetId: 'local-image',
    assetId: 'media/image-model',
    kind: LocalAssetKind.IMAGE,
    status: LocalAssetStatus.ACTIVE,
    capabilities: ['image'],
    engine: 'media',
  });
  const transfer = generatedTransferSummary();
  const dependencyJob = generatedEnvironmentDependencyJob();
  const local = {
    ...emptyLocalRpc(),
    async listVerifiedAssets(request: unknown, options?: unknown) {
      calls.push({ method: 'listVerifiedAssets', request, options });
      return {
        assets: [{
          templateId: 'verified.image',
          title: 'Verified Image',
          description: 'Verified image model',
          installKind: 'download',
          assetId: 'media/image-model',
          kind: LocalAssetKind.IMAGE,
          logicalModelId: 'image-model',
          repo: 'owner/image',
          revision: '',
          capabilities: ['image'],
          engine: 'media',
          entry: 'model.gguf',
          files: ['model.gguf'],
          license: 'apache-2.0',
          hashes: { sha256: 'abc' },
          endpoint: 'http://127.0.0.1:7860',
          fileCount: 0,
          totalSizeBytes: '1024',
          tags: ['image'],
        }],
        nextPageToken: '',
      };
    },
    async searchCatalogModels(request: unknown, options?: unknown) {
      calls.push({ method: 'searchCatalogModels', request, options });
      return {
        items: [catalogItem()],
      };
    },
    async listCatalogVariants(request: unknown, options?: unknown) {
      calls.push({ method: 'listCatalogVariants', request, options });
      return {
        variants: [{
          filename: 'model.Q4_K_M.gguf',
          entry: 'model.Q4_K_M.gguf',
          files: ['model.Q4_K_M.gguf'],
          format: 'gguf',
          sizeBytes: '1024',
          sha256: 'abc',
        }],
      };
    },
    async resolveModelInstallPlan(request: unknown, options?: unknown) {
      calls.push({ method: 'resolveModelInstallPlan', request, options });
      return { plan: generatedInstallPlan() };
    },
    async installModelFromPlan(request: unknown, options?: unknown) {
      calls.push({ method: 'installModelFromPlan', request, options });
      return { asset };
    },
    async installVerifiedAsset(request: unknown, options?: unknown) {
      calls.push({ method: 'installVerifiedAsset', request, options });
      return { asset };
    },
    async importLocalAsset(request: unknown, options?: unknown) {
      calls.push({ method: 'importLocalAsset', request, options });
      return { asset };
    },
    async importLocalAssetFile(request: unknown, options?: unknown) {
      calls.push({ method: 'importLocalAssetFile', request, options });
      return { asset };
    },
    async importLocalAssetBundle(request: unknown, options?: unknown) {
      calls.push({ method: 'importLocalAssetBundle', request, options });
      return { transfer };
    },
    async rescanLocalAssetBundle(request: unknown, options?: unknown) {
      calls.push({ method: 'rescanLocalAssetBundle', request, options });
      return { transfer };
    },
    async removeLocalAsset(request: unknown, options?: unknown) {
      calls.push({ method: 'removeLocalAsset', request, options });
      return { asset };
    },
    async startLocalAsset(request: unknown, options?: unknown) {
      calls.push({ method: 'startLocalAsset', request, options });
      return { asset };
    },
    async stopLocalAsset(request: unknown, options?: unknown) {
      calls.push({ method: 'stopLocalAsset', request, options });
      return { asset };
    },
    async listLocalTransfers(request: unknown, options?: unknown) {
      calls.push({ method: 'listLocalTransfers', request, options });
      return { transfers: [transfer] };
    },
    async pauseLocalTransfer(request: unknown, options?: unknown) {
      calls.push({ method: 'pauseLocalTransfer', request, options });
      return { transfer: { ...transfer, state: 'paused' } };
    },
    async resumeLocalTransfer(request: unknown, options?: unknown) {
      calls.push({ method: 'resumeLocalTransfer', request, options });
      return { transfer: { ...transfer, state: 'running' } };
    },
    async cancelLocalTransfer(request: unknown, options?: unknown) {
      calls.push({ method: 'cancelLocalTransfer', request, options });
      return { transfer: { ...transfer, state: 'cancelled' } };
    },
    async *watchLocalTransfers(request: unknown, options?: unknown) {
      calls.push({ method: 'watchLocalTransfers', request, options });
      yield generatedTransferProgressEvent();
    },
    async collectDeviceProfile(request: unknown, options?: unknown) {
      calls.push({ method: 'collectDeviceProfile', request, options });
      return { profile: generatedDeviceProfile() };
    },
    async getRecommendationFeed(request: unknown, options?: unknown) {
      calls.push({ method: 'getRecommendationFeed', request, options });
      return {
        feed: {
          deviceProfile: generatedDeviceProfile(),
          activeCapability: LocalRecommendationFeedCapability.IMAGE,
          generatedAt: '2026-06-05T00:00:00.000Z',
          cacheState: LocalRecommendationFeedCacheState.FRESH,
          items: [],
        },
      };
    },
    async resolveProfile(request: unknown, options?: unknown) {
      calls.push({ method: 'resolveProfile', request, options });
      return { plan: generatedProfileResolutionPlan() };
    },
    async applyProfile(request: unknown, options?: unknown) {
      calls.push({ method: 'applyProfile', request, options });
      return { result: generatedProfileApplyResult(asset) };
    },
    async resolveLocalEnvironmentPlan(request: unknown, options?: unknown) {
      calls.push({ method: 'resolveLocalEnvironmentPlan', request, options });
      return { plan: generatedEnvironmentPlan() };
    },
    async applyLocalEnvironmentPlan(request: unknown, options?: unknown) {
      calls.push({ method: 'applyLocalEnvironmentPlan', request, options });
      return { plan: generatedEnvironmentPlan(), jobs: [dependencyJob] };
    },
    async listLocalEnvironmentDependencyJobs(request: unknown, options?: unknown) {
      calls.push({ method: 'listLocalEnvironmentDependencyJobs', request, options });
      return { jobs: [dependencyJob] };
    },
    async startLocalEnvironmentDependencyJob(request: unknown, options?: unknown) {
      calls.push({ method: 'startLocalEnvironmentDependencyJob', request, options });
      return { job: dependencyJob };
    },
    async cancelLocalEnvironmentDependencyJob(request: unknown, options?: unknown) {
      calls.push({ method: 'cancelLocalEnvironmentDependencyJob', request, options });
      return { job: { ...dependencyJob, state: 'cancelled' } };
    },
    async retryLocalEnvironmentDependencyJob(request: unknown, options?: unknown) {
      calls.push({ method: 'retryLocalEnvironmentDependencyJob', request, options });
      return { job: { ...dependencyJob, state: 'queued' } };
    },
    async repairLocalEnvironmentDependency(request: unknown, options?: unknown) {
      calls.push({ method: 'repairLocalEnvironmentDependency', request, options });
      return { job: { ...dependencyJob, state: 'installing' } };
    },
    async scanUnregisteredAssets(request: unknown, options?: unknown) {
      calls.push({ method: 'scanUnregisteredAssets', request, options });
      return {
        items: [{
          filename: 'orphan.gguf',
          path: '/models/orphan.gguf',
          sizeBytes: '1024',
          declaration: { assetKind: LocalAssetKind.CHAT, engine: 'llama' },
          suggestionSource: 'filename',
          confidence: 'high',
          autoImportable: true,
          requiresManualReview: false,
          folderName: 'models',
        }],
      };
    },
    async scaffoldOrphanAsset(request: unknown, options?: unknown) {
      calls.push({ method: 'scaffoldOrphanAsset', request, options });
      return { asset };
    },
  } as NimiRuntimeLocalAssetAdminRpc;
  const client = createNimiRuntimeLocalAssetAdminClient({ local, callOptions });

  assert.equal((await client.listVerifiedAssets({ kind: 'image', engine: 'media' }))[0]?.kind, 'image');
  assert.equal((await client.searchCatalog({ query: 'image', capability: 'image' }))[0]?.engineRuntimeMode, 'supervised');
  assert.equal((await client.listCatalogVariants('owner/image'))[0]?.filename, 'model.Q4_K_M.gguf');
  const plan = await client.resolveInstallPlan({ itemId: 'item-1', capabilities: ['image'] });
  assert.equal(plan.engineRuntimeMode, 'supervised');
  assert.equal((await client.install(plan, writeOptions)).localAssetId, 'local-image');
  assert.equal((await client.installVerifiedAsset({ templateId: 'verified.image' }, writeOptions)).kind, 'image');
  assert.equal((await client.importAsset({ manifestPath: '/models/manifest.json', engineConfig: { batch: 1 } }, writeOptions)).engine, 'media');
  assert.equal((await client.importAssetManifest('/models/manifest.json', writeOptions)).asset.localAssetId, 'local-image');
  assert.equal((await client.importAssetFile({
    filePath: '/models/model.gguf',
    declaration: { assetKind: 'image', engine: 'media' },
  }, writeOptions)).asset.kind, 'image');
  assert.equal((await client.importFile({ filePath: '/models/model.gguf', assetName: 'Image', kind: 'image' }, writeOptions)).localAssetId, 'local-image');
  assert.equal((await client.importBundle({
    directoryPath: '/models/image',
    modelName: 'Image',
    orderedBundleEntries: ['model-00001.gguf', 'model-00002.gguf'],
  }, writeOptions)).installSessionId, 'transfer-1');
  assert.equal((await client.rescanBundle({ localAssetId: 'local-image' }, writeOptions)).localAssetId, 'local-image');
  assert.equal((await client.remove('local-image', writeOptions)).status, 'active');
  assert.equal((await client.start('local-image', writeOptions)).status, 'active');
  assert.equal((await client.stop('local-image', writeOptions)).status, 'active');
  assert.equal((await client.listTransfers())[0]?.bytesReceived, 1024);
  assert.equal((await client.pauseTransfer('transfer-1', writeOptions)).state, 'paused');
  assert.equal((await client.resumeTransfer('transfer-1', writeOptions)).state, 'running');
  assert.equal((await client.cancelTransfer('transfer-1', writeOptions)).state, 'cancelled');
  const progressEvents: unknown[] = [];
  const dispose = await client.watchTransferProgress((event) => progressEvents.push(event));
  await new Promise((resolve) => setImmediate(resolve));
  dispose();
  assert.equal((progressEvents[0] as { state?: string } | undefined)?.state, 'running');
  assert.equal((await client.collectDeviceProfile({ extraPorts: [3000, 3000.8, Number.NaN] })).ports.length, 1);
  assert.equal((await client.getRecommendationFeed({ capability: 'image', pageSize: 1 })).activeCapability, 'image');
  const profilePlan = await client.resolveProfile({
    targetId: 'target-image',
    profile: localProfile(),
    capability: 'image',
    deviceProfile: projectNimiRuntimeLocalDeviceProfile(generatedDeviceProfile()),
    entryOverrides: [{ entryId: 'image-model', localAssetId: 'local-image' }],
  });
  assert.equal(profilePlan.profileId, 'profile-image');
  assert.equal((await client.applyProfile(profilePlan, writeOptions)).installedAssets[0]?.localAssetId, 'local-image');
  const environmentPlan = await client.resolveEnvironmentPlan({ packId: 'local-image-native', consumerScope: 'stable-diffusion.cpp.metal' });
  assert.equal(environmentPlan.dependencies[0]?.dependencyId, 'stable-diffusion.cpp');
  assert.equal(environmentPlan.dependencies[0]?.consumerScope, 'stable-diffusion.cpp.metal');
  assert.deepEqual({
    requiredDependencyFamilies: environmentPlan.requiredDependencyFamilies,
    aggregateSizeKnown: environmentPlan.aggregateSizeKnown,
    aggregateSizeBytes: environmentPlan.aggregateSizeBytes,
    storageCategories: environmentPlan.storageCategories,
    sourceOwners: environmentPlan.sourceOwners,
    noSystemMutation: environmentPlan.noSystemMutation,
  }, {
    requiredDependencyFamilies: ['native-engine-package.stablediffusion-ggml'],
    aggregateSizeKnown: false,
    aggregateSizeBytes: 0,
    storageCategories: ['environments'],
    sourceOwners: ['RuntimeLocalService'],
    noSystemMutation: true,
  });
  const appliedEnvironment = await client.applyEnvironmentPlan({
    resolution: {
      packId: 'local-image-native',
      consumerScope: 'stable-diffusion.cpp.metal',
      localAssetId: 'local-image',
    },
    expectedPlanId: environmentPlan.planId,
    confirmed: true,
  }, writeOptions);
  assert.equal(appliedEnvironment.plan.planId, environmentPlan.planId);
  assert.equal(appliedEnvironment.jobs[0]?.jobId, 'job-1');
  assert.equal((await client.listEnvironmentDependencyJobs({ environmentKey: 'env-1', state: 'queued' }))[0]?.jobId, 'job-1');
  assert.equal((await client.listEnvironmentDependencyJobs({ environmentKey: 'env-1', state: 'queued' }))[0]?.consumerScope, 'stable-diffusion.cpp.metal');
  assert.equal((await client.startEnvironmentDependencyJob({
    environmentKey: 'env-1',
    dependencyFamily: 'image-native',
    dependencyId: 'stable-diffusion.cpp',
    sourceKind: 'managed',
    confirmed: true,
    consumerScope: 'stable-diffusion.cpp.metal',
  }, writeOptions)).state, 'queued');
  assert.equal((await client.cancelEnvironmentDependencyJob({ jobId: 'job-1' }, writeOptions)).state, 'cancelled');
  assert.equal((await client.retryEnvironmentDependencyJob({ jobId: 'job-1', confirmed: true }, writeOptions)).state, 'queued');
  assert.equal((await client.repairEnvironmentDependency({
    environmentKey: 'env-1',
    dependencyFamily: 'image-native',
    dependencyId: 'stable-diffusion.cpp',
    confirmed: true,
    reasonCode: 'repair_required',
    consumerScope: 'stable-diffusion.cpp.metal',
  }, writeOptions)).state, 'installing');
  assert.equal((await client.scanUnregisteredAssets())[0]?.declaration?.assetKind, 'chat');
  assert.equal((await client.scaffoldOrphanAsset({ path: '/models/orphan.gguf', kind: 'chat' }, writeOptions)).localAssetId, 'local-image');

  assert.equal(calls.some((call) => call.method === 'installModelFromPlan' && call.options === writeOptions.callOptions), true);
  assert.deepEqual(calls.find((call) => call.method === 'collectDeviceProfile')?.request, { extraPorts: [3000, 3000] });
  assert.deepEqual(calls.find((call) => call.method === 'importLocalAssetBundle')?.request, {
    directoryPath: '/models/image',
    modelName: 'Image',
    capabilities: [],
    engine: '',
    orderedBundleEntries: ['model-00001.gguf', 'model-00002.gguf'],
  });
  const importRequest = calls.find((call) => call.method === 'importLocalAsset')?.request as Record<string, unknown>;
  assert.equal('endpoint' in importRequest, false);
  assert.deepEqual(calls.find((call) => call.method === 'repairLocalEnvironmentDependency')?.request, {
    environmentKey: 'env-1',
    dependencyFamily: 'image-native',
    dependencyId: 'stable-diffusion.cpp',
    confirmed: true,
    reasonCode: 'repair_required',
    consumerScope: 'stable-diffusion.cpp.metal',
  });
  assert.deepEqual(calls.find((call) => call.method === 'startLocalEnvironmentDependencyJob')?.request, {
    environmentKey: 'env-1',
    dependencyFamily: 'image-native',
    dependencyId: 'stable-diffusion.cpp',
    sourceKind: 'managed',
    confirmed: true,
    consumerScope: 'stable-diffusion.cpp.metal',
  });
  assert.deepEqual(calls.find((call) => call.method === 'applyLocalEnvironmentPlan'), {
    method: 'applyLocalEnvironmentPlan',
    request: {
      resolution: {
        packId: 'local-image-native',
        consumerScope: 'stable-diffusion.cpp.metal',
        runtimeDataRoot: '',
        assetId: '',
        localAssetId: 'local-image',
        companionAssetId: '',
        parentAssetId: '',
        installLevel: '',
      },
      expectedPlanId: 'env-plan-1',
      confirmed: true,
    },
    options: { timeoutMs: 10 },
  });
});

test('Runtime local model center client fails closed on missing required Runtime responses', async () => {
  const client = createNimiRuntimeLocalAssetAdminClient({
    local: {
      ...emptyLocalRpc(),
      async resolveModelInstallPlan() {
        return {};
      },
      async collectDeviceProfile() {
        return {};
      },
    },
  });

  await assert.rejects(
    () => client.resolveInstallPlan({ itemId: 'item-1' }),
    (error: unknown) => {
      const record = error as { code?: string; reasonCode?: string };
      assert.equal(record.code ?? record.reasonCode, 'SDK_RUNTIME_LOCAL_RESPONSE_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.collectDeviceProfile(),
    (error: unknown) => {
      const record = error as { code?: string; reasonCode?: string };
      assert.equal(record.code ?? record.reasonCode, 'SDK_RUNTIME_LOCAL_RESPONSE_INVALID');
      return true;
    },
  );
});

function catalogItem() {
  return {
    itemId: 'item-1',
    source: 'verified',
    title: 'Image model',
    description: 'Image model',
    modelId: 'local/image-model',
    repo: 'owner/image',
    revision: '',
    templateId: 'verified.image',
    capabilities: ['image'],
    engine: 'media',
    engineRuntimeMode: LocalEngineRuntimeMode.SUPERVISED,
    installKind: 'download',
    installAvailable: true,
    endpoint: 'http://127.0.0.1:7860',
    entry: 'model.gguf',
    files: ['model.gguf'],
    license: 'apache-2.0',
    hashes: { sha256: 'abc' },
    tags: ['image'],
    downloads: '10',
    likes: '2',
    lastModified: '2026-06-05T00:00:00.000Z',
    verified: true,
  };
}

function generatedInstallPlan() {
  return {
    planId: 'plan-1',
    itemId: 'item-1',
    source: 'verified',
    templateId: 'verified.image',
    modelId: 'local/image-model',
    repo: 'owner/image',
    revision: '',
    capabilities: ['image'],
    engine: 'media',
    engineRuntimeMode: LocalEngineRuntimeMode.SUPERVISED,
    installKind: 'download',
    installAvailable: true,
    endpoint: 'http://127.0.0.1:7860',
    entry: 'model.gguf',
    files: ['model.gguf'],
    license: 'apache-2.0',
    hashes: { sha256: 'abc' },
    warnings: ['verify disk space'],
    reasonCode: '',
  };
}

function generatedTransferSummary() {
  return {
    installSessionId: 'transfer-1',
    assetId: 'media/image-model',
    localAssetId: 'local-image',
    sessionKind: 'import',
    phase: 'copying',
    state: 'running',
    bytesReceived: '1024',
    bytesTotal: '2048',
    speedBytesPerSec: '512',
    etaSeconds: '2',
    message: 'copying',
    reasonCode: '',
    retryable: false,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:01:00.000Z',
  };
}

function generatedTransferProgressEvent() {
  return {
    ...generatedTransferSummary(),
    done: false,
    success: false,
  };
}

function generatedDeviceProfile() {
  return {
    os: 'darwin',
    arch: 'arm64',
    totalRamBytes: '17179869184',
    availableRamBytes: '8589934592',
    diskFreeBytes: '34359738368',
    ports: [{ port: 3000, available: true }],
    gpu: {
      available: true,
      vendor: 'Apple',
      model: 'M3',
      totalVramBytes: '8589934592',
      availableVramBytes: '4294967296',
      memoryModel: 2,
    },
    python: { available: true, version: '3.12' },
    npu: { available: true, ready: true, vendor: 'Apple', runtime: 'ane', detail: 'ready' },
  };
}

function localProfile(): NimiRuntimeLocalProfileDescriptor {
  return {
    id: 'profile-image',
    title: 'Image profile',
    recommended: true,
    consumeCapabilities: ['image'],
    entries: [{
      entryId: 'image-model',
      kind: 'asset',
      capability: 'image',
      assetId: 'media/image-model',
      assetKind: 'image',
      engine: 'media',
      required: true,
    }],
  };
}

function generatedProfileResolutionPlan() {
  return {
    planId: 'profile-plan-1',
    targetId: 'target-image',
    profileId: 'profile-image',
    title: 'Image profile',
    description: 'Image profile',
    recommended: true,
    consumeCapabilities: ['image'],
    warnings: [],
    reasonCode: '',
  };
}

function generatedProfileApplyResult(asset: ReturnType<typeof generatedAsset>) {
  return {
    planId: 'profile-plan-1',
    targetId: 'target-image',
    profileId: 'profile-image',
    installedAssets: [asset],
    warnings: [],
    reasonCode: SdkReasonCode.ACTION_EXECUTED,
  };
}

function generatedEnvironmentPlan() {
  return {
    planId: 'env-plan-1',
    packId: 'local-image-native',
    productLabel: 'Local image native runtime',
    hostProfileId: 'host-1',
    platformTuple: 'darwin-arm64',
    runtimeDataRoot: '/runtime/data',
    consumerScope: 'stable-diffusion.cpp.metal',
    cloudOnlyImpact: 'none',
    state: 'ready_system',
    reasonCode: '',
    requiredDependencyFamilies: ['native-engine-package.stablediffusion-ggml'],
    aggregateSizeKnown: false,
    aggregateSizeBytes: '0',
    storageCategories: ['environments'],
    sourceOwners: ['RuntimeLocalService'],
    noSystemMutation: true,
    dependencies: [{
      dependencyFamily: 'image-native',
      dependencyId: 'stable-diffusion.cpp',
      required: true,
      state: 'ready_system',
      sourceKind: 'managed',
      confirmationRequired: false,
      selectedSourceRecordId: 'source-1',
      environmentKey: 'env-1',
      consumerScope: 'stable-diffusion.cpp.metal',
      canonicalRoot: '/runtime/deps/stable-diffusion.cpp',
      reasonCode: '',
      detail: 'ready',
    }],
  };
}

function generatedEnvironmentDependencyJob() {
  return {
    jobId: 'job-1',
    environmentKey: 'env-1',
    dependencyFamily: 'image-native',
    dependencyId: 'stable-diffusion.cpp',
    consumerScope: 'stable-diffusion.cpp.metal',
    state: 'queued',
    sourceKind: 'managed',
    canonicalRoot: '/runtime/deps/stable-diffusion.cpp',
    selectedSourceRecordId: 'source-1',
    failureDetail: '',
    retryable: true,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:01:00.000Z',
    reasonCode: '',
    recoveryDisposition: 'continue',
    bytesReceived: '0',
    bytesTotal: '1024',
    percent: 0,
    speedBytesPerSec: '0',
    etaSeconds: '0',
  };
}

function recommendationFeedItem(input: {
  readonly itemId: string;
  readonly title: string;
  readonly repo: string;
  readonly tier: 'recommended' | 'runnable' | 'tight' | 'not_recommended';
  readonly downloads: number;
  readonly likes: number;
  readonly license: string;
  readonly entry: string;
  readonly totalSizeBytes: number;
  readonly installed?: boolean;
}): NimiRuntimeLocalRecommendationFeedItem {
  return {
    itemId: input.itemId,
    source: 'model-index',
    repo: input.repo,
    revision: 'main',
    title: input.title,
    description: '',
    capabilities: ['image'],
    tags: ['image'],
    formats: ['gguf'],
    downloads: input.downloads,
    likes: input.likes,
    lastModified: '2026-06-05T00:00:00.000Z',
    preferredEngine: 'media',
    verified: true,
    entries: [{
      entryId: input.entry,
      format: 'gguf',
      entry: input.entry,
      files: [input.entry],
      totalSizeBytes: input.totalSizeBytes,
    }],
    recommendation: {
      source: 'media-fit',
      format: 'gguf',
      tier: input.tier,
      reasonCodes: [],
      recommendedEntry: input.entry,
      fallbackEntries: [],
      suggestedAssets: [],
      suggestedNotes: [],
      baseline: 'image-default-v1',
    },
    installedState: {
      installed: Boolean(input.installed),
      status: input.installed ? 'installed' : undefined,
    },
    actionState: {
      canReviewInstallPlan: true,
      canOpenVariants: true,
      canOpenLocalAsset: Boolean(input.installed),
    },
    installPayload: {
      modelId: `local/${input.itemId}`,
      kind: 'image',
      repo: input.repo,
      revision: 'main',
      capabilities: ['image'],
      engine: 'media',
      entry: input.entry,
      files: [input.entry],
      license: input.license,
      hashes: {},
    },
  };
}

function generatedAsset(input: Partial<Parameters<typeof projectNimiRuntimeLocalCatalogItemDescriptor>[0]> & {
  readonly localAssetId?: string;
  readonly status?: LocalAssetStatus;
  readonly displayName?: string;
  readonly sourceFileName?: string;
}) {
  return {
    localAssetId: input.localAssetId ?? 'local-asset',
    assetId: input.assetId ?? 'local/asset',
    kind: input.kind ?? LocalAssetKind.CHAT,
    engine: input.engine ?? 'llama',
    entry: input.entry ?? 'model.gguf',
    files: input.files ?? ['model.gguf'],
    license: input.license ?? 'apache-2.0',
    source: {
      repo: input.repo ?? 'owner/model',
      revision: input.revision ?? 'main',
    },
    hashes: input.hashes ?? {},
    status: input.status ?? LocalAssetStatus.INSTALLED,
    installedAt: '',
    updatedAt: '',
    healthDetail: '',
    capabilities: input.capabilities ?? [],
    logicalModelId: '',
    family: '',
    artifactRoles: [],
    preferredEngine: '',
    fallbackEngines: [],
    bundleState: 0,
    localInvokeProfileId: '',
    reasonCode: 0,
    displayName: input.displayName ?? '',
    sourceFileName: input.sourceFileName ?? '',
  };
}

function emptyLocalRpc(): NimiRuntimeLocalAssetAdminRpc {
  const missing = async (): Promise<never> => {
    throw new Error('unexpected local Runtime call');
  };
  const missingStream = async function* (): AsyncIterable<never> {
    throw new Error('unexpected local Runtime stream');
  };
  return {
    listLocalAssets: missing,
    removeLocalAsset: missing,
    startLocalAsset: missing,
    stopLocalAsset: missing,
    listVerifiedAssets: missing,
    searchCatalogModels: missing,
    listCatalogVariants: missing,
    getRecommendationFeed: missing,
    resolveModelInstallPlan: missing,
    installModelFromPlan: missing,
    installVerifiedAsset: missing,
    importLocalAsset: missing,
    importLocalAssetFile: missing,
    importLocalAssetBundle: missing,
    rescanLocalAssetBundle: missing,
    listLocalTransfers: missing,
    pauseLocalTransfer: missing,
    resumeLocalTransfer: missing,
    cancelLocalTransfer: missing,
    watchLocalTransfers: missingStream,
    collectDeviceProfile: missing,
    scanUnregisteredAssets: missing,
    scaffoldOrphanAsset: missing,
    resolveProfile: missing,
    applyProfile: missing,
    resolveLocalEnvironmentPlan: missing,
    applyLocalEnvironmentPlan: missing,
    listLocalEnvironmentDependencyJobs: missing,
    startLocalEnvironmentDependencyJob: missing,
    cancelLocalEnvironmentDependencyJob: missing,
    retryLocalEnvironmentDependencyJob: missing,
    repairLocalEnvironmentDependency: missing,
  } as NimiRuntimeLocalAssetAdminRpc;
}
