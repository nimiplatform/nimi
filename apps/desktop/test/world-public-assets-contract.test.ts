import assert from 'node:assert/strict';
import test from 'node:test';

import { realmWorldData } from '../src/shell/renderer/features/world/data/realm-world-data';
import { fetchWorldPublicAssets } from '../src/shell/renderer/features/world/world-detail-queries';

const originalLoadWorldAssets = realmWorldData.loadWorldAssets.bind(realmWorldData);
const originalLoadWorldScenes = realmWorldData.loadWorldScenes.bind(realmWorldData);

type WorldAssetListPayload = Awaited<ReturnType<typeof realmWorldData.loadWorldAssets>>;
type WorldSceneListPayload = Awaited<ReturnType<typeof realmWorldData.loadWorldScenes>>;

function stubPublicAssetLoads(input?: {
  assets?: Partial<WorldAssetListPayload>;
  scenes?: { worldId?: string; items: unknown[] };
}) {
  realmWorldData.loadWorldAssets = (async () => ({
    resourceRefs: [],
    externalRefs: [],
    intents: [],
    ...input?.assets,
  } as WorldAssetListPayload)) as typeof realmWorldData.loadWorldAssets;
  realmWorldData.loadWorldScenes = (async () => ({
    worldId: 'world-1',
    items: [],
    ...input?.scenes,
  } as unknown as WorldSceneListPayload)) as typeof realmWorldData.loadWorldScenes;
}

test.after(() => {
  realmWorldData.loadWorldAssets = originalLoadWorldAssets;
  realmWorldData.loadWorldScenes = originalLoadWorldScenes;
});

test('fetchWorldPublicAssets decodes canonical WorldCore asset references without fallback synthesis', async () => {
  stubPublicAssetLoads({
    assets: {
      resourceRefs: [{
        refId: 'resource-1',
        kind: 'image',
        purpose: 'banner',
        label: 'Cover',
      }],
      externalRefs: [{
        refId: 'external-1',
        kind: 'image',
        uri: 'https://example.com/cover.png',
        purpose: 'cover',
        label: 'Cover URL',
      }],
      intents: [{
        intentId: 'intent-1',
        kind: 'reference-image',
        summary: 'Generate a canonical cover image.',
      }],
    },
    scenes: {
      items: [{
        sceneId: 'scene-1',
        name: '花果山',
        summary: '齐天大圣的居所',
        entityRefs: ['world-character-wukong', 'world-character-bajie'],
      }],
    },
  });

  const payload = await fetchWorldPublicAssets('world-1');
  assert.equal(payload.resourceRefs[0]?.refId, 'resource-1');
  assert.equal(payload.externalRefs[0]?.uri, 'https://example.com/cover.png');
  assert.equal(payload.intents[0]?.intentId, 'intent-1');
  assert.equal(payload.scenes.length, 1);
  assert.equal(payload.scenes[0]?.name, '花果山');
  assert.deepEqual(payload.scenes[0]?.activeEntities, ['world-character-wukong', 'world-character-bajie']);
});

test('fetchWorldPublicAssets drops malformed external refs instead of inventing URLs', async () => {
  stubPublicAssetLoads({
    assets: {
      externalRefs: [{
        refId: 'external-1',
        kind: 'image',
      }],
    },
  });

  const payload = await fetchWorldPublicAssets('world-1');
  assert.deepEqual(payload.externalRefs, []);
});
