import assert from 'node:assert/strict';
import test from 'node:test';

import { dataSync } from '../src/runtime/data-sync';
import { fetchWorldPublicAssets } from '../src/shell/renderer/features/world/world-detail-queries';

const originalLoadWorldLorebooks = dataSync.loadWorldLorebooks.bind(dataSync);
const originalLoadWorldResourceBindings = dataSync.loadWorldResourceBindings.bind(dataSync);

type WorldLorebookListPayload = Awaited<ReturnType<typeof dataSync.loadWorldLorebooks>>;
type WorldResourceBindingListPayload = Awaited<ReturnType<typeof dataSync.loadWorldResourceBindings>>;

function stubPublicAssetLoads(input?: {
  lorebooks?: { worldId?: string; items: unknown[] };
  resourceBindings?: { worldId?: string; items: unknown[] };
}) {
  dataSync.loadWorldLorebooks = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.lorebooks,
  } as unknown as WorldLorebookListPayload)) as typeof dataSync.loadWorldLorebooks;
  dataSync.loadWorldResourceBindings = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.resourceBindings,
  } as unknown as WorldResourceBindingListPayload)) as typeof dataSync.loadWorldResourceBindings;
}

test.after(() => {
  dataSync.loadWorldLorebooks = originalLoadWorldLorebooks;
  dataSync.loadWorldResourceBindings = originalLoadWorldResourceBindings;
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
    resourceBindings: {
      items: [{
        id: 'binding-1',
        targetType: 'WORLD',
        targetId: 'world-1',
        slot: 'WORLD_BANNER',
        priority: 1,
        tags: ['cover'],
        resource: {
          id: 'resource-1',
          url: 'https://example.com/cover.png',
          resourceType: 'IMAGE',
          label: 'Cover',
        },
      }],
    },
  });

  const payload = await fetchWorldPublicAssets('world-1');
  assert.equal(payload.lorebooks[0]?.key, 'chronicle');
  assert.deepEqual(payload.scenes, []);
  assert.equal(payload.resourceBindings[0]?.resource.resourceType, 'IMAGE');
});

test('fetchWorldPublicAssets fails close when projection contract fields are missing', async () => {
  stubPublicAssetLoads({
    resourceBindings: {
      items: [{
        id: 'binding-1',
        targetType: 'WORLD',
        targetId: 'world-1',
        slot: 'WORLD_BANNER',
        priority: 1,
        tags: ['cover'],
        resource: {
          id: 'resource-1',
          resourceType: 'IMAGE',
          label: 'Cover',
        },
      }],
    },
  });

  await assert.rejects(
    () => fetchWorldPublicAssets('world-1'),
    /WORLD_DETAIL_RESOURCE_BINDING_RESOURCE_URL_INVALID/,
  );
});
