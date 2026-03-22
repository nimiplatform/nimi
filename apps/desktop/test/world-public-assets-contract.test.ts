import assert from 'node:assert/strict';
import test from 'node:test';

import { dataSync } from '../src/runtime/data-sync';
import { fetchWorldPublicAssets } from '../src/shell/renderer/features/world/world-detail-queries';

const originalLoadWorldLorebooks = dataSync.loadWorldLorebooks.bind(dataSync);
const originalLoadWorldMediaBindings = dataSync.loadWorldMediaBindings.bind(dataSync);

type WorldLorebookListPayload = Awaited<ReturnType<typeof dataSync.loadWorldLorebooks>>;
type WorldMediaBindingListPayload = Awaited<ReturnType<typeof dataSync.loadWorldMediaBindings>>;

function stubPublicAssetLoads(input?: {
  lorebooks?: { worldId?: string; items: unknown[] };
  mediaBindings?: { worldId?: string; items: unknown[] };
}) {
  dataSync.loadWorldLorebooks = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.lorebooks,
  } as unknown as WorldLorebookListPayload)) as typeof dataSync.loadWorldLorebooks;
  dataSync.loadWorldMediaBindings = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.mediaBindings,
  } as unknown as WorldMediaBindingListPayload)) as typeof dataSync.loadWorldMediaBindings;
}

test.after(() => {
  dataSync.loadWorldLorebooks = originalLoadWorldLorebooks;
  dataSync.loadWorldMediaBindings = originalLoadWorldMediaBindings;
});

test('fetchWorldPublicAssets decodes projection payloads without fallback synthesis', async () => {
  stubPublicAssetLoads({
    lorebooks: {
      items: [{
        id: 'lore-1',
        worldId: 'world-1',
        key: 'chronicle',
        name: 'Chronicle',
        content: 'Primary knowledge entry',
        keywords: ['timeline'],
        priority: 8,
      }],
    },
    mediaBindings: {
      items: [{
        id: 'binding-1',
        targetType: 'WORLD',
        targetId: 'world-1',
        slot: 'WORLD_BANNER',
        priority: 1,
        tags: ['cover'],
        asset: {
          id: 'asset-1',
          url: 'https://example.com/cover.png',
          mediaType: 'IMAGE',
          label: 'Cover',
        },
      }],
    },
  });

  const payload = await fetchWorldPublicAssets('world-1');
  assert.equal(payload.lorebooks[0]?.key, 'chronicle');
  assert.deepEqual(payload.scenes, []);
  assert.equal(payload.mediaBindings[0]?.asset.mediaType, 'IMAGE');
});

test('fetchWorldPublicAssets fails close when projection contract fields are missing', async () => {
  stubPublicAssetLoads({
    mediaBindings: {
      items: [{
        id: 'binding-1',
        targetType: 'WORLD',
        targetId: 'world-1',
        slot: 'WORLD_BANNER',
        priority: 1,
        tags: ['cover'],
        asset: {
          id: 'asset-1',
          mediaType: 'IMAGE',
          label: 'Cover',
        },
      }],
    },
  });

  await assert.rejects(
    () => fetchWorldPublicAssets('world-1'),
    /WORLD_DETAIL_MEDIA_BINDING_ASSET_URL_INVALID/,
  );
});
