import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorldRelationshipExplorerModel,
  sameIdentityCharacters,
} from '../src/shell/renderer/features/world/world-detail-relationship-model.js';
import type { WorldCharacter, WorldDetailData } from '../src/shell/renderer/features/world/world-detail-types.js';

function world(overrides: Partial<WorldDetailData> = {}): WorldDetailData {
  return {
    id: 'world-1',
    name: '元代文人书院世界',
    description: 'A traceable relationship world.',
    iconUrl: null,
    bannerUrl: null,
    type: 'CREATOR',
    status: 'DISCOVERABLE',
    level: 1,
    levelUpdatedAt: null,
    characterCount: 4,
    createdAt: '2026-06-18T00:00:00.000Z',
    creatorId: null,
    freezeReason: null,
    scoreA: 0,
    scoreC: 0,
    scoreE: 0,
    scoreEwma: 0,
    scoreQ: 0,
    time: { mode: 'static', label: null, currentWorldTime: null },
    relationshipCount: 97438,
    timelineEventCount: 0,
    ...overrides,
  } as WorldDetailData;
}

function character(
  id: string,
  name: string,
  overrides: Partial<WorldCharacter> = {},
): WorldCharacter {
  return {
    id,
    name,
    handle: id,
    bio: `${name} bio`,
    sourceRef: {
      kind: 'worldCharacter',
      id,
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: `entity-${id}` },
      sourceHash: 'a'.repeat(64),
    },
    sourceKind: 'worldCharacter',
    ownership: 'worldOwned',
    relation: {
      state: 'connectable',
      connectionId: null,
      runtimeSourceRef: null,
    },
    role: null,
    faction: null,
    rank: null,
    sceneName: null,
    location: null,
    traits: [],
    topics: [],
    createdAt: '2026-06-19T00:00:00.000Z',
    avatarUrl: null,
    profileCoverUrl: null,
    importance: 'PRIMARY',
    stats: null,
    ...overrides,
  };
}

test('relationship explorer derives no relationship edges, kinship nodes, or clues from topics and traits', () => {
  const characters = [
    character('ma-zu-chang', '马祖常', {
      topics: [
        'kinship: 祖父马世昌，家族渊源。',
        'kinship：父亲李嗣。',
        '与许有壬有交往，许有壬是元代中后期重要文臣。',
        '《牧庵集》为其文学结晶。',
      ],
      traits: ['翰林学士承旨为其仕途顶峰。'],
    }),
    character('xu-you-ren', '许有壬'),
  ];

  const model = buildWorldRelationshipExplorerModel({
    world: world(),
    characters,
    preferredCenterId: 'ma-zu-chang',
  });

  assert.deepEqual(Object.keys(model).sort(), ['center', 'people', 'summary']);
  // People are exactly the World's characters; no pseudo-person (马世昌, 李嗣)
  // is extracted from prose.
  assert.deepEqual(model.people.map((person) => person.name), ['马祖常', '许有壬']);
  assert.equal(model.center?.name, '马祖常');
});

test('relationship explorer centers on the explicit selection, then a primary character, then the first', () => {
  const characters = [
    character('background', 'Background Crew', { importance: 'BACKGROUND' }),
    character('mira', 'Mira', { importance: 'PRIMARY' }),
    character('oriel', 'Oriel Vantasse', { importance: 'SECONDARY' }),
  ];

  assert.equal(buildWorldRelationshipExplorerModel({ world: world(), characters }).center?.name, 'Mira');
  assert.equal(
    buildWorldRelationshipExplorerModel({ world: world(), characters, preferredCenterId: 'oriel' }).center?.name,
    'Oriel Vantasse',
  );
  assert.equal(
    buildWorldRelationshipExplorerModel({
      world: world(),
      characters: characters.filter((item) => item.importance !== 'PRIMARY'),
    }).center?.name,
    'Background Crew',
  );
  assert.equal(buildWorldRelationshipExplorerModel({ world: world(), characters: [] }).center, null);
});

test('relationship explorer summary uses explicit World statistics and omits an absent relationship count', () => {
  const characters = [
    character('mira', 'Mira'),
    character('oriel', 'Oriel Vantasse', { importance: 'SECONDARY' }),
  ];

  assert.deepEqual(buildWorldRelationshipExplorerModel({ world: world(), characters }).summary, {
    relationshipCount: 97438,
  });
  assert.equal(
    buildWorldRelationshipExplorerModel({ world: world({ relationshipCount: undefined }), characters }).summary.relationshipCount,
    null,
  );
});

test('same-identity grouping uses only equal explicit fields, not shared characters such as 师', () => {
  const mage = character('mage', '艾琳', { role: '魔法师' });
  const characters = [
    mage,
    character('engineer', '陈工', { role: '工程师' }),
    character('chef', '老周', { role: '厨师' }),
    character('teacher', '林老师', { role: '书院讲师' }),
    character('mage-2', 'Oriel Vantasse', { role: '魔法师' }),
  ];

  assert.deepEqual(sameIdentityCharacters(mage, characters).map((item) => item.name), ['Oriel Vantasse']);
  assert.deepEqual(
    sameIdentityCharacters(character('solo', 'Mira', { role: null, faction: '  ', rank: null }), characters),
    [],
  );
});
