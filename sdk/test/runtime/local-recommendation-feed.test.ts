import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_RECOMMENDATION_FORMAT_IDS,
  LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS,
  formatLocalRecommendationRepoOwner,
  localRecommendationFeedMatchesQuery,
  localRecommendationTierToRunGrade,
  normalizeLocalRecommendationFeedCapabilityId,
  parseLocalRecommendationBaselineId,
  parseLocalRecommendationFeedCacheStateId,
  parseLocalRecommendationFeedCapabilityId,
  parseLocalRecommendationFeedSourceId,
  parseLocalRecommendationFormatId,
  parseLocalRecommendationHostSupportClassId,
  parseLocalRecommendationSourceId,
  parseLocalRecommendationTierId,
  parseRuntimeLocalCatalogRecommendation,
  parseRuntimeLocalRecommendationFeedDescriptor,
  selectLocalRecommendationPrimaryEntrySize,
  summarizeLocalRecommendationFeedCacheState,
  toLocalRecommendationFeedCapabilityRequestValue,
} from '../../src/runtime/index.js';
import {
  LocalHostSupportClass,
  LocalRecommendationBaseline,
  LocalRecommendationFeedCacheState,
  LocalRecommendationFeedCapability,
  LocalRecommendationFeedSource,
  LocalRecommendationFormat,
  LocalRecommendationSource,
  LocalRecommendationTier,
} from '../../src/runtime/generated/runtime/v1/local_runtime_types.js';

test('local recommendation feed capabilities are projected from Runtime enum order', () => {
  assert.deepEqual(LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS, ['chat', 'image', 'video']);
  assert.deepEqual(LOCAL_RECOMMENDATION_FORMAT_IDS, ['gguf', 'safetensors']);
});

test('local recommendation feed capability parser accepts Runtime wire names and values', () => {
  assert.equal(parseLocalRecommendationFeedCapabilityId(LocalRecommendationFeedCapability.CHAT), 'chat');
  assert.equal(parseLocalRecommendationFeedCapabilityId('LOCAL_RECOMMENDATION_FEED_CAPABILITY_IMAGE'), 'image');
  assert.equal(parseLocalRecommendationFeedCapabilityId('3'), 'video');
  assert.equal(parseLocalRecommendationFeedCapabilityId('tts'), undefined);
});

test('local recommendation feed enum parsers accept Runtime wire names and values', () => {
  assert.equal(parseLocalRecommendationSourceId(LocalRecommendationSource.MEDIA_FIT), 'media-fit');
  assert.equal(parseLocalRecommendationSourceId('LOCAL_RECOMMENDATION_SOURCE_LLMFIT'), 'llmfit');
  assert.equal(parseLocalRecommendationFormatId(LocalRecommendationFormat.SAFETENSORS), 'safetensors');
  assert.equal(parseLocalRecommendationFormatId('LOCAL_RECOMMENDATION_FORMAT_GGUF'), 'gguf');
  assert.equal(parseLocalRecommendationTierId(LocalRecommendationTier.NOT_RECOMMENDED), 'not_recommended');
  assert.equal(parseLocalRecommendationTierId('4'), 'not_recommended');
  assert.equal(parseLocalRecommendationHostSupportClassId(LocalHostSupportClass.ATTACHED_ONLY), 'attached_only');
  assert.equal(parseLocalRecommendationHostSupportClassId('LOCAL_HOST_SUPPORT_CLASS_SUPPORTED_SUPERVISED'), 'supported_supervised');
  assert.equal(parseLocalRecommendationBaselineId(LocalRecommendationBaseline.VIDEO_DEFAULT_V1), 'video-default-v1');
  assert.equal(parseLocalRecommendationBaselineId('LOCAL_RECOMMENDATION_BASELINE_IMAGE_DEFAULT_V1'), 'image-default-v1');
  assert.equal(parseLocalRecommendationFeedCacheStateId(LocalRecommendationFeedCacheState.STALE), 'stale');
  assert.equal(parseLocalRecommendationFeedCacheStateId('LOCAL_RECOMMENDATION_FEED_CACHE_STATE_EMPTY'), 'empty');
  assert.equal(parseLocalRecommendationFeedSourceId(LocalRecommendationFeedSource.MODEL_INDEX), 'model-index');
  assert.equal(parseLocalRecommendationFeedSourceId('LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX'), 'model-index');
});

test('local recommendation feed capability request value fails closed to chat', () => {
  assert.equal(normalizeLocalRecommendationFeedCapabilityId('video'), 'video');
  assert.equal(normalizeLocalRecommendationFeedCapabilityId('music'), 'chat');
  assert.equal(toLocalRecommendationFeedCapabilityRequestValue('LOCAL_RECOMMENDATION_FEED_CAPABILITY_IMAGE'), 'image');
});

test('local recommendation feed projection utilities preserve Runtime feed semantics', () => {
  const item = {
    repo: 'model-lab/small-chat',
    title: 'Small Chat 7B',
    description: 'chat model',
    tags: ['chat'],
    capabilities: ['chat'],
    formats: ['gguf'],
    recommendation: {
      tier: 'LOCAL_RECOMMENDATION_TIER_RUNNABLE',
      recommendedEntry: 'q4.gguf',
    },
    installPayload: {
      modelId: 'model-lab/small-chat-q4',
    },
    entries: [
      { entry: 'q8.gguf', totalSizeBytes: 8 },
      { entry: 'q4.gguf', totalSizeBytes: 4 },
    ],
  };

  assert.equal(localRecommendationTierToRunGrade(item.recommendation.tier), 'runs_well');
  assert.equal(localRecommendationTierToRunGrade('unknown'), 'not_recommended');
  assert.equal(summarizeLocalRecommendationFeedCacheState({ cacheState: LocalRecommendationFeedCacheState.FRESH }), 'fresh');
  assert.equal(summarizeLocalRecommendationFeedCacheState(null), 'empty');
  assert.equal(formatLocalRecommendationRepoOwner('model-lab/small-chat'), 'Model Lab');
  assert.equal(selectLocalRecommendationPrimaryEntrySize(item), 4);
  assert.equal(localRecommendationFeedMatchesQuery(item, 'small-chat-q4'), true);
  assert.equal(localRecommendationFeedMatchesQuery(item, 'speech'), false);
});

test('local recommendation catalog parser fails closed on invalid source', () => {
  assert.equal(parseRuntimeLocalCatalogRecommendation({
    tier: 'recommended',
    reasonCodes: ['memory_headroom_recommended'],
  }), undefined);
  assert.equal(parseRuntimeLocalCatalogRecommendation({
    source: 'guessed-media-fit',
    tier: 'recommended',
    reasonCodes: [],
  }), undefined);
});

test('local recommendation feed parser decodes Runtime projection without owning feed truth', () => {
  const parsed = parseRuntimeLocalRecommendationFeedDescriptor({
    deviceProfile: { os: 'darwin' },
    activeCapability: 'LOCAL_RECOMMENDATION_FEED_CAPABILITY_IMAGE',
    cacheState: LocalRecommendationFeedCacheState.STALE,
    generatedAt: '2026-03-17T10:00:00Z',
    items: [
      {
        itemId: 'candidate-image-1',
        source: LocalRecommendationFeedSource.MODEL_INDEX,
        repo: 'Tongyi-MAI/Z-Image-Turbo',
        revision: 'main',
        title: 'Z Image Turbo',
        capabilities: ['image'],
        tags: ['image', 'z-image'],
        formats: ['LOCAL_RECOMMENDATION_FORMAT_GGUF', 'bin'],
        preferredEngine: 'media',
        verified: true,
        entries: [
          {
            entryId: 'q4-k',
            format: 'LOCAL_RECOMMENDATION_FORMAT_GGUF',
            entry: 'z-image-q4.gguf',
            files: ['z-image-q4.gguf'],
            totalSizeBytes: '2048',
          },
          {
            entryId: 'invalid-format',
            format: 'bin',
            entry: 'z-image.bin',
          },
        ],
        recommendation: {
          source: LocalRecommendationSource.MEDIA_FIT,
          tier: LocalRecommendationTier.RECOMMENDED,
          reasonCodes: ['memory_headroom_recommended'],
        },
        installedState: {
          installed: true,
          localModelId: 'hf:tongyi-z-image-turbo',
          status: 'LOCAL_ASSET_STATUS_INSTALLED',
        },
        actionState: {
          canReviewInstallPlan: true,
          canOpenVariants: true,
          canOpenLocalModel: true,
        },
        installPayload: {
          modelId: 'Tongyi-MAI/Z-Image-Turbo',
          kind: 'LOCAL_ASSET_KIND_IMAGE',
          repo: 'Tongyi-MAI/Z-Image-Turbo',
          revision: 'main',
          capabilities: ['image'],
          engine: 'media',
          entry: 'z-image-q4.gguf',
          files: ['z-image-q4.gguf'],
          license: 'tongyi',
          hashes: { sha256: 'abc123' },
        },
      },
    ],
  }, (value) => value as { os: string });

  assert.equal(parsed.deviceProfile.os, 'darwin');
  assert.equal(parsed.activeCapability, 'image');
  assert.equal(parsed.cacheState, 'stale');
  assert.equal(parsed.items[0]?.entries.length, 1);
  assert.equal(parsed.items[0]?.entries[0]?.totalSizeBytes, 2048);
  assert.equal(parsed.items[0]?.formats.length, 1);
  assert.equal(parsed.items[0]?.recommendation?.source, 'media-fit');
  assert.equal(parsed.items[0]?.installedState.localAssetId, 'hf:tongyi-z-image-turbo');
  assert.equal(parsed.items[0]?.installedState.status, 'installed');
  assert.equal(parsed.items[0]?.actionState.canOpenLocalAsset, true);
  assert.equal(parsed.items[0]?.installPayload.kind, 'image');
  assert.deepEqual(parsed.items[0]?.installPayload.hashes, { sha256: 'abc123' });
});

test('local recommendation feed parser rejects invalid wrapper fields and drops invalid items', () => {
  assert.throws(
    () => parseRuntimeLocalRecommendationFeedDescriptor({
      activeCapability: 'tts',
      cacheState: 'fresh',
      items: [],
    }, () => null),
    /recommendationFeed\.activeCapability/,
  );
  assert.throws(
    () => parseRuntimeLocalRecommendationFeedDescriptor({
      activeCapability: 'chat',
      cacheState: 'cached',
      items: [],
    }, () => null),
    /recommendationFeed\.cacheState/,
  );

  const parsed = parseRuntimeLocalRecommendationFeedDescriptor({
    activeCapability: 'chat',
    cacheState: 'fresh',
    items: [
      {
        itemId: 'invalid-source',
        source: 'other-index',
        repo: 'repo/model',
        title: 'Model',
        preferredEngine: 'llama',
        installPayload: { modelId: 'repo/model', repo: 'repo/model' },
      },
    ],
  }, () => null);

  assert.equal(parsed.items.length, 0);
});
