import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorldRelationshipEvidenceGraph,
  classifyRelationshipEvidence,
} from '../src/shell/renderer/features/world/world-detail-relationship-model.js';
import type { WorldCharacter, WorldDetailData, WorldHistoryBundle } from '../src/shell/renderer/features/world/world-detail-types.js';

function world(): WorldDetailData {
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
    flowRatio: 1,
    relationshipCount: 97438,
    timelineEventCount: 0,
  };
}

function history(): WorldHistoryBundle {
  return {
    items: [],
    summary: null,
  };
}

function character(id: string, name: string, tags: readonly string[] = []): WorldCharacter {
  return {
    id,
    name,
    handle: id,
    bio: `${name} bio`,
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: id,
      sourceContentHash: `${id}-hash`,
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
    tags,
    createdAt: '2026-06-19T00:00:00.000Z',
    avatarUrl: null,
    profileCoverUrl: null,
    importance: 'PRIMARY',
    stats: null,
  };
}

test('relationship evidence graph links only notes that name another world character', () => {
  const characters = [
    character('yao-sui', '姚燧', [
      '与许有壬有交往，许有壬是元代中后期重要文臣。',
      '姚枢是其伯父，理学家。',
      '翰林学士承旨为其仕途顶峰。',
    ]),
    character('xu-you-ren', '许有壬'),
    character('yao-shu', '姚枢'),
    character('wu-cheng', '吴澄'),
  ];

  const graph = buildWorldRelationshipEvidenceGraph({
    world: world(),
    characters,
    history: history(),
    preferredCenterId: 'yao-sui',
  });

  assert.deepEqual(
    graph.edges.map((edge) => [edge.targetName, edge.kind]),
    [
      ['许有壬', 'association'],
      ['姚枢', 'kinship'],
    ],
  );
  assert.equal(graph.unlinkedEvidence.length, 1);
  assert.equal(graph.unlinkedEvidence[0]?.kind, 'office');
  assert.equal(graph.summary.relationshipCount, 97438);
  assert.equal(graph.summary.linkedCharacterCount, 1);
  assert.equal(graph.summary.clueCharacterCount, 0);
  assert.equal(graph.summary.emptyCharacterCount, 3);
});

test('relationship evidence graph promotes named kinship clues without world character records', () => {
  const characters = [
    character('ma-zu-chang', '马祖常', [
      'kinship: 祖父马世昌，家族渊源。',
      'kinship: 长子马式，家族传承。',
      'kinship: 次子马熙，家族传承。',
    ]),
    character('huang-jin', '黄溍'),
  ];

  const graph = buildWorldRelationshipEvidenceGraph({
    world: world(),
    characters,
    history: history(),
    preferredCenterId: 'ma-zu-chang',
  });

  assert.deepEqual(
    graph.edges.map((edge) => [edge.targetName, edge.kind, edge.targetIsWorldCharacter]),
    [
      ['马世昌', 'kinship', false],
      ['马式', 'kinship', false],
      ['马熙', 'kinship', false],
    ],
  );
  assert.equal(graph.unlinkedEvidence.length, 0);
  assert.equal(graph.kindCounts.kinship, 3);
  assert.equal(graph.summary.linkedEvidenceCount, 3);
});

test('relationship evidence graph does not split zi-ending kinship names into role-prefixed aliases', () => {
  const characters = [
    character('ma-zu-chang', '马祖常', [
      'kinship: 长子马武子，家族传承。',
      'kinship: 次子马文子，家族传承。',
    ]),
  ];

  const graph = buildWorldRelationshipEvidenceGraph({
    world: world(),
    characters,
    history: history(),
    preferredCenterId: 'ma-zu-chang',
  });

  assert.deepEqual(
    graph.edges.map((edge) => edge.targetName).sort(),
    ['马文子', '马武子'],
  );
  assert.equal(
    graph.edges.some((edge) => edge.targetName === '长子马武' || edge.targetName === '次子马文'),
    false,
  );
  assert.equal(graph.summary.linkedEvidenceCount, 2);
});

test('relationship evidence graph resolves the longest kinship term before extracting the name', () => {
  const characters = [
    character('li-shang-yin', '李商隐', [
      'kinship：父亲李嗣。李商隐早年丧父，家境贫寒，这段经历塑造了他敏感的性格和对家族的责任感。',
      'kinship：李商隐娶王茂元之女，卷入牛李党争。',
    ]),
  ];

  const graph = buildWorldRelationshipEvidenceGraph({
    world: world(),
    characters,
    history: history(),
    preferredCenterId: 'li-shang-yin',
  });

  // 父亲李嗣 must yield exactly 李嗣 — not a second 亲李嗣 node from the
  // single-character 父 term, and no narrative fragments as pseudo-people.
  assert.deepEqual(
    graph.edges.map((edge) => edge.targetName),
    ['李嗣'],
  );
  assert.equal(
    graph.edges.some((edge) => /亲李嗣|李商隐早年丧|李商隐娶王茂元之/.test(edge.targetName)),
    false,
  );
  // The fullwidth-colon kind prefix is stripped from displayed evidence text.
  assert.equal(
    graph.edges.some((edge) => edge.evidenceTexts.some((text) => text.startsWith('kinship'))),
    false,
  );
});

test('relationship evidence graph separates linked, clue-only, and empty characters', () => {
  const characters = [
    character('wu-cheng', '吴澄', ['核心人物', '文学']),
    character('yao-sui', '姚燧', ['与许有壬有交往，许有壬是元代中后期重要文臣。']),
    character('xu-you-ren', '许有壬'),
    character('li-cun', '李存', ['翰林学士承旨为其仕途顶峰。']),
  ];

  const graph = buildWorldRelationshipEvidenceGraph({
    world: world(),
    characters,
    history: history(),
  });

  assert.equal(graph.center?.name, '姚燧');
  assert.deepEqual(graph.density.linked.map((bucket) => bucket.character.name), ['姚燧']);
  assert.deepEqual(graph.density.clueOnly.map((bucket) => bucket.character.name), ['李存']);
  assert.deepEqual(graph.density.empty.map((bucket) => bucket.character.name), ['吴澄', '许有壬']);
  assert.equal(graph.summary.evidenceCharacterCount, 2);
});

test('relationship evidence graph rejects negative notes instead of drawing them as edges', () => {
  const graph = buildWorldRelationshipEvidenceGraph({
    world: world(),
    characters: [
      character('yao-sui', '姚燧', ['吴澄与姚燧未确认直接边，显示为候选路径。']),
      character('wu-cheng', '吴澄'),
    ],
    history: history(),
    preferredCenterId: 'yao-sui',
  });

  assert.equal(graph.edges.length, 0);
  assert.equal(graph.unlinkedEvidence.length, 0);
});

test('relationship evidence graph does not fabricate edges when tags are generic', () => {
  const graph = buildWorldRelationshipEvidenceGraph({
    world: world(),
    characters: [
      character('yao-sui', '姚燧', ['核心人物', '文学']),
      character('wu-cheng', '吴澄'),
    ],
    history: history(),
    preferredCenterId: 'yao-sui',
  });

  assert.equal(graph.edges.length, 0);
  assert.equal(graph.unlinkedEvidence.length, 0);
  assert.equal(graph.summary.linkedEvidenceCount, 0);
});

test('relationship evidence classifier preserves relation categories', () => {
  assert.equal(classifyRelationshipEvidence('与许有壬有交往。'), 'association');
  assert.equal(classifyRelationshipEvidence('姚枢是其伯父。'), 'kinship');
  assert.equal(classifyRelationshipEvidence('翰林学士承旨为其仕途顶峰。'), 'office');
  assert.equal(classifyRelationshipEvidence('《牧庵集》为其文学结晶。'), 'text');
});
