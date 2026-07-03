import assert from 'node:assert/strict';
import test from 'node:test';

import { realmWorldData } from '../src/shell/renderer/features/world/data/realm-world-data';
import {
  buildWorldPublicScenes,
  projectWorldPublicDetail,
} from '../src/shell/renderer/features/world/data/world-public-projection';
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
        activeEntities: [
          { id: 'world-character-wukong', kind: 'person', label: '孙悟空' },
          { id: 'world-character-bajie', kind: 'person', label: '猪八戒' },
        ],
        relatedCharacters: [{
          id: 'world-character-wukong',
          displayName: '孙悟空',
          handle: 'wukong',
          role: '行者',
          summary: '花果山旧主。',
          tags: [],
          sourceKind: 'worldCharacter',
          worldId: 'world-1',
          worldName: '西游世界',
          ownership: 'worldOwned',
          updatedAt: '2026-01-01T00:00:00.000Z',
          media: {},
          relation: { state: 'connectable', connectionId: null, runtimeSourceRef: null },
          sourceRef: {
            kind: 'worldCharacter',
            sourceId: 'world-character-wukong',
            worldId: 'world-1',
            sourceContentHash: 'hash-wukong',
          },
        }],
        relatedEvents: [{
          eventId: 'return-to-mountain',
          title: '重回花果山',
          summary: '孙悟空回到花果山整顿群猴。',
          sequence: 1,
          timestamp: null,
          startsAt: null,
          endsAt: null,
          importance: null,
          sceneRefs: ['scene-1'],
          locationRefs: ['world-character-wukong'],
          entityRefs: ['world-character-wukong'],
          characterRefs: ['world-character-wukong'],
          sourceRefs: [],
        }],
        relatedResources: [{
          id: 'entity:world-character-wukong',
          kind: 'entity',
          title: '孙悟空',
          summary: '花果山相关实体。',
          entityRefs: ['world-character-wukong'],
          eventRefs: [],
        }],
        counts: {
          activeEntityCount: 2,
          relatedCharacterCount: 1,
          relatedEventCount: 1,
          relatedResourceCount: 1,
        },
        media: [{
          id: 'scene-image-1',
          kind: 'highlight',
          url: 'https://example.com/scene.png',
          provider: 'cloudflare',
          provenance: {},
        }],
      }],
    },
  });

  const payload = await fetchWorldPublicAssets('world-1');
  assert.equal(payload.resourceRefs[0]?.refId, 'resource-1');
  assert.equal(payload.externalRefs[0]?.uri, 'https://example.com/cover.png');
  assert.equal(payload.intents[0]?.intentId, 'intent-1');
  assert.equal(payload.scenes.length, 1);
  const scene = payload.scenes[0] as unknown as {
    readonly name?: string;
    readonly activeEntities?: unknown;
    readonly relatedCharacters?: readonly { readonly name?: string; readonly displayName?: string }[];
    readonly relatedEvents?: readonly { readonly title?: string }[];
    readonly relatedResources?: readonly { readonly title?: string }[];
    readonly counts?: {
      readonly activeEntityCount?: number;
      readonly relatedCharacterCount?: number;
      readonly relatedEventCount?: number;
      readonly relatedResourceCount?: number;
    };
    readonly media?: readonly { readonly url?: string }[];
  };
  assert.equal(scene.name, '花果山');
  assert.deepEqual(scene.activeEntities, [
    { id: 'world-character-wukong', kind: 'person', label: '孙悟空', summary: null },
    { id: 'world-character-bajie', kind: 'person', label: '猪八戒', summary: null },
  ]);
  assert.deepEqual(scene.relatedCharacters?.map((character) => character.name ?? character.displayName), ['孙悟空']);
  assert.deepEqual(scene.relatedEvents?.map((event) => event.title), ['重回花果山']);
  assert.deepEqual(scene.relatedResources?.map((resource) => resource.title), ['孙悟空']);
  assert.deepEqual(scene.counts, {
    activeEntityCount: 2,
    relatedCharacterCount: 1,
    relatedEventCount: 1,
    relatedResourceCount: 1,
  });
  assert.equal(scene.media?.[0]?.url, 'https://example.com/scene.png');
});

test('world public detail projection preserves structured scene records from the canonical detail payload', () => {
  const projected = projectWorldPublicDetail({
    id: 'world-1',
    name: '西游世界',
    summary: '取经路上的人、地与事件。',
    type: 'CREATOR',
    visibility: 'public',
    tags: [],
    entityKinds: [],
    relationshipTypes: [],
    media: {},
    time: {},
    stats: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rules: [],
    systems: [],
    timeline: [],
    scenes: [{
      sceneId: 'scene-1',
      name: '花果山',
      summary: '齐天大圣的居所',
      activeEntities: [{ id: 'world-character-wukong', kind: 'person', label: '孙悟空' }],
      media: [{
        id: 'scene-image-1',
        kind: 'highlight',
        url: 'https://example.com/scene.png',
        provider: 'cloudflare',
        provenance: {},
      }],
      relatedCharacters: [],
      relatedEvents: [],
      relatedResources: [],
      counts: {
        activeEntityCount: 1,
        relatedCharacterCount: 0,
        relatedEventCount: 0,
        relatedResourceCount: 0,
      },
    }],
  } as never);

  const scenes = buildWorldPublicScenes(projected);

  assert.equal(scenes.items.length, 1);
  assert.equal(scenes.items[0]?.sceneId, 'scene-1');
  assert.equal(scenes.items[0]?.name, '花果山');
  assert.equal((scenes.items[0]?.media as Array<{ url?: string }> | undefined)?.[0]?.url, 'https://example.com/scene.png');
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
