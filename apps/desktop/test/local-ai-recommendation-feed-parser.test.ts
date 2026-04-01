import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDeviceProfile, parseRecommendationFeedDescriptor } from '../src/runtime/local-runtime/parsers.js';

function deviceProfileFixture() {
  return {
    os: 'darwin',
    arch: 'aarch64',
    totalRamBytes: 64 * 1024 * 1024 * 1024,
    availableRamBytes: 48 * 1024 * 1024 * 1024,
    gpu: {
      available: true,
      vendor: 'Apple',
      model: 'M3 Max',
      totalVramBytes: 0,
      availableVramBytes: 0,
      memoryModel: 'unified',
    },
    python: { available: true, version: '3.11.8' },
    npu: { available: false, ready: false },
    diskFreeBytes: 1024,
    ports: [],
  };
}

function recommendationFeedFixture() {
  return {
    deviceProfile: deviceProfileFixture(),
    activeCapability: 'image',
    cacheState: 'stale',
    generatedAt: '2026-03-17T10:00:00Z',
    items: [
      {
        itemId: 'candidate-image-1',
        source: 'model-index',
        repo: 'Tongyi-MAI/Z-Image-Turbo',
        revision: 'main',
        title: 'Z Image Turbo',
        capabilities: ['image'],
        tags: ['image', 'z-image'],
        formats: ['gguf'],
        preferredEngine: 'localai',
        verified: true,
        entries: [
          {
            entryId: 'q4-k',
            format: 'gguf',
            entry: 'z-image-q4.gguf',
            files: ['z-image-q4.gguf'],
            totalSizeBytes: 2048,
          },
        ],
        recommendation: {
          source: 'invalid-source',
          tier: 'recommended',
          reasonCodes: ['memory_headroom_recommended'],
        },
        installedState: {
          installed: false,
        },
        actionState: {
          canReviewInstallPlan: true,
          canOpenVariants: true,
          canOpenLocalModel: false,
        },
        installPayload: {
          assetId: 'local/z-image-turbo',
          repo: 'Tongyi-MAI/Z-Image-Turbo',
          revision: 'main',
          capabilities: ['image'],
          engine: 'localai',
          entry: 'z-image-q4.gguf',
          files: ['z-image-q4.gguf'],
          license: 'tongyi',
          hashes: {},
        },
      },
    ],
  };
}

test('parseRecommendationFeedDescriptor keeps feed shape and fails closed for invalid recommendation source', () => {
  const parsed = parseRecommendationFeedDescriptor(recommendationFeedFixture(), parseDeviceProfile);

  assert.equal(parsed.cacheState, 'stale');
  assert.equal(parsed.activeCapability, 'image');
  assert.equal(parsed.items[0]?.entries[0]?.format, 'gguf');
  assert.equal(parsed.items[0]?.recommendation, undefined);
});

test('parseRecommendationFeedDescriptor rejects invalid wrapper capability instead of defaulting to chat', () => {
  const payload = recommendationFeedFixture();
  payload.activeCapability = 'tts';

  assert.throws(
    () => parseRecommendationFeedDescriptor(payload, parseDeviceProfile),
    /recommendationFeed\.activeCapability/,
  );
});

test('parseRecommendationFeedDescriptor rejects invalid wrapper cacheState instead of defaulting to empty', () => {
  const payload = recommendationFeedFixture();
  payload.cacheState = 'cached';

  assert.throws(
    () => parseRecommendationFeedDescriptor(payload, parseDeviceProfile),
    /recommendationFeed\.cacheState/,
  );
});

test('parseRecommendationFeedDescriptor drops items with invalid entry format', () => {
  const payload = recommendationFeedFixture();
  payload.items[0]!.entries[0]!.format = 'bin';

  const parsed = parseRecommendationFeedDescriptor(payload, parseDeviceProfile);
  assert.equal(parsed.items[0]?.entries.length, 0);
});

test('parseRecommendationFeedDescriptor drops items with invalid source or missing install payload identity', () => {
  const payload = recommendationFeedFixture();
  const baseItem = payload.items[0]!;
  payload.items = [
    {
      ...baseItem,
      itemId: 'invalid-source',
      source: 'other-index',
    },
    {
      ...baseItem,
      itemId: 'missing-install-asset-id',
      installPayload: {
        ...baseItem.installPayload,
        assetId: '',
      },
    },
  ] as typeof payload.items;

  const parsed = parseRecommendationFeedDescriptor(payload, parseDeviceProfile);
  assert.equal(parsed.items.length, 0);
});
