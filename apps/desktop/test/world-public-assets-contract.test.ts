import assert from 'node:assert/strict';
import test from 'node:test';

import { dataSync } from '../src/runtime/data-sync';
import { fetchWorldPublicAssets } from '../src/shell/renderer/features/world/world-detail-queries';

const originalLoadWorldLorebooks = dataSync.loadWorldLorebooks.bind(dataSync);
const originalLoadWorldBindings = dataSync.loadWorldBindings.bind(dataSync);
const originalLoadWorldScenes = dataSync.loadWorldScenes.bind(dataSync);

type WorldLorebookListPayload = Awaited<ReturnType<typeof dataSync.loadWorldLorebooks>>;
type WorldBindingListPayload = Awaited<ReturnType<typeof dataSync.loadWorldBindings>>;
type WorldSceneListPayload = Awaited<ReturnType<typeof dataSync.loadWorldScenes>>;

function stubPublicAssetLoads(input?: {
  lorebooks?: { worldId?: string; items: unknown[] };
  bindings?: { worldId?: string; items: unknown[] };
  scenes?: { worldId?: string; items: unknown[] };
}) {
  dataSync.loadWorldLorebooks = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.lorebooks,
  } as unknown as WorldLorebookListPayload)) as typeof dataSync.loadWorldLorebooks;
  dataSync.loadWorldBindings = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.bindings,
  } as unknown as WorldBindingListPayload)) as typeof dataSync.loadWorldBindings;
  dataSync.loadWorldScenes = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.scenes,
  } as unknown as WorldSceneListPayload)) as typeof dataSync.loadWorldScenes;
}

test.after(() => {
  dataSync.loadWorldLorebooks = originalLoadWorldLorebooks;
  dataSync.loadWorldBindings = originalLoadWorldBindings;
  dataSync.loadWorldScenes = originalLoadWorldScenes;
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
    bindings: {
      items: [{
        id: 'binding-1',
        objectType: 'RESOURCE',
        objectId: 'resource-1',
        hostType: 'WORLD',
        hostId: 'world-1',
        bindingKind: 'PRESENTATION',
        bindingPoint: 'WORLD_BANNER',
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
    scenes: {
      items: [{
        id: 'scene-1',
        name: '花果山',
        description: '齐天大圣的居所',
        activeEntities: ['agent-wukong', 'agent-bajie'],
      }],
    },
  });

  const payload = await fetchWorldPublicAssets('world-1');
  assert.equal(payload.lorebooks[0]?.key, 'chronicle');
  assert.equal(payload.scenes.length, 1);
  assert.equal(payload.scenes[0]?.name, '花果山');
  assert.deepEqual(payload.scenes[0]?.activeEntities, ['agent-wukong', 'agent-bajie']);
  assert.equal(payload.bindings[0]?.resource.resourceType, 'IMAGE');
});

test('fetchWorldPublicAssets fails close when projection contract fields are missing', async () => {
  stubPublicAssetLoads({
    bindings: {
      items: [{
        id: 'binding-1',
        objectType: 'RESOURCE',
        objectId: 'resource-1',
        hostType: 'WORLD',
        hostId: 'world-1',
        bindingKind: 'PRESENTATION',
        bindingPoint: 'WORLD_BANNER',
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
    /WORLD_DETAIL_BINDING_RESOURCE_URL_INVALID/,
  );
});
