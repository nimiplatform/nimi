import assert from 'node:assert/strict';
import test from 'node:test';

import { dataSync } from '../src/runtime/data-sync';
import { fetchWorldPublicAssets } from '../src/shell/renderer/features/world/world-detail-queries';

const originalLoadWorldLorebooks = dataSync.loadWorldLorebooks.bind(dataSync);
const originalLoadWorldScenes = dataSync.loadWorldScenes.bind(dataSync);
const originalLoadWorldMediaBindings = dataSync.loadWorldMediaBindings.bind(dataSync);

type WorldLorebookListPayload = Awaited<ReturnType<typeof dataSync.loadWorldLorebooks>>;
type WorldSceneListPayload = Awaited<ReturnType<typeof dataSync.loadWorldScenes>>;
type WorldMediaBindingListPayload = Awaited<ReturnType<typeof dataSync.loadWorldMediaBindings>>;

function stubPublicAssetLoads(input?: {
  lorebooks?: { worldId?: string; items: unknown[] };
  scenes?: { worldId?: string; items: unknown[] };
  mediaBindings?: { worldId?: string; items: unknown[] };
}) {
  dataSync.loadWorldLorebooks = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.lorebooks,
  } as unknown as WorldLorebookListPayload)) as typeof dataSync.loadWorldLorebooks;
  dataSync.loadWorldScenes = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.scenes,
  } as unknown as WorldSceneListPayload)) as typeof dataSync.loadWorldScenes;
  dataSync.loadWorldMediaBindings = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.mediaBindings,
  } as unknown as WorldMediaBindingListPayload)) as typeof dataSync.loadWorldMediaBindings;
}

test.after(() => {
  dataSync.loadWorldLorebooks = originalLoadWorldLorebooks;
  dataSync.loadWorldScenes = originalLoadWorldScenes;
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
    scenes: {
      items: [{
        id: 'scene-1',
        worldId: 'world-1',
        name: 'Jade Court',
        description: 'Seat of power',
        activeEntities: ['agent-1'],
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
  assert.equal(payload.scenes[0]?.name, 'Jade Court');
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
