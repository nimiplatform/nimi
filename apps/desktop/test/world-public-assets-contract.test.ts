import assert from 'node:assert/strict';
import test from 'node:test';

import { realmWorldData } from '../src/shell/renderer/features/world/data/realm-world-data';
import { fetchWorldPublicAssets } from '../src/shell/renderer/features/world/world-detail-queries';

const originalLoadWorldLorebooks = realmWorldData.loadWorldLorebooks.bind(realmWorldData);
const originalLoadWorldBindings = realmWorldData.loadWorldBindings.bind(realmWorldData);
const originalLoadWorldScenes = realmWorldData.loadWorldScenes.bind(realmWorldData);

type WorldLorebookListPayload = Awaited<ReturnType<typeof realmWorldData.loadWorldLorebooks>>;
type WorldBindingListPayload = Awaited<ReturnType<typeof realmWorldData.loadWorldBindings>>;
type WorldSceneListPayload = Awaited<ReturnType<typeof realmWorldData.loadWorldScenes>>;

function stubPublicAssetLoads(input?: {
  lorebooks?: { worldId?: string; items: unknown[] };
  bindings?: { worldId?: string; items: unknown[] };
  scenes?: { worldId?: string; items: unknown[] };
}) {
  realmWorldData.loadWorldLorebooks = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.lorebooks,
  } as unknown as WorldLorebookListPayload)) as typeof realmWorldData.loadWorldLorebooks;
  realmWorldData.loadWorldBindings = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.bindings,
  } as unknown as WorldBindingListPayload)) as typeof realmWorldData.loadWorldBindings;
  realmWorldData.loadWorldScenes = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.scenes,
  } as unknown as WorldSceneListPayload)) as typeof realmWorldData.loadWorldScenes;
}

test.after(() => {
  realmWorldData.loadWorldLorebooks = originalLoadWorldLorebooks;
  realmWorldData.loadWorldBindings = originalLoadWorldBindings;
  realmWorldData.loadWorldScenes = originalLoadWorldScenes;
});

test('fetchWorldPublicAssets decodes WorldCore public asset payloads without fallback synthesis', async () => {
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
        activeEntities: ['world-character-wukong', 'world-character-bajie'],
      }],
    },
  });

  const payload = await fetchWorldPublicAssets('world-1');
  assert.equal(payload.lorebooks[0]?.key, 'chronicle');
  assert.equal(payload.scenes.length, 1);
  assert.equal(payload.scenes[0]?.name, '花果山');
  assert.deepEqual(payload.scenes[0]?.activeEntities, ['world-character-wukong', 'world-character-bajie']);
  assert.equal(payload.bindings[0]?.resource.resourceType, 'IMAGE');
});

test('fetchWorldPublicAssets fails close when WorldCore display binding fields are missing', async () => {
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
    (error: unknown) => {
      assert.equal(
        (error as { readonly reasonCode?: string }).reasonCode,
        'SDK_REALM_WORLD_DISPLAY_BINDING_RESOURCE_URL_INVALID',
      );
      return true;
    },
  );
});
