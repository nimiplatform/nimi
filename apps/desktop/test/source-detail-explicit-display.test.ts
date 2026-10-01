import assert from 'node:assert/strict';
import test from 'node:test';

import {
  React,
  SourceDetailView,
  changeLocale,
  initI18n,
  ouYangDeRaw,
  renderToStaticMarkup,
  toSourceDetailData,
} from './source-detail-world-character-test-utils.js';
import { composeWorldCharacterMilestones } from '../src/shell/renderer/features/source-detail/source-detail-world-character-milestones.js';
import type { SourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model.js';

test.before(async () => {
  await initI18n();
});

function render(source: SourceDetailData): string {
  return renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: null,
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
    }),
  );
}

function sliceBetween(markup: string, startMarker: string, endMarker: string): string {
  const start = markup.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = markup.indexOf(endMarker, start);
  return markup.slice(start, end >= 0 ? end : undefined);
}

function cardsBy(markup: string, testId: string): string[] {
  return markup
    .split(`data-testid="${testId}"`)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('</article>')));
}

const worldRef = {
  kind: 'worldCharacter',
  id: 'last-star-mira',
  worldId: 'the-last-star',
  worldEntityRef: { kind: 'worldEntity', worldId: 'the-last-star', entityId: 'entity-mira' },
  sourceHash: 'c'.repeat(64),
};

// A non-historical World with English, mixed-script, and Chinese text whose
// fragments (任, 子, 代, 门) must not be read as office, kinship, or era facts.
const miraRaw = {
  id: worldRef.id,
  displayName: 'Mira',
  handle: 'mira',
  bio: 'Station cartographer of The Last Star.',
  worldId: worldRef.worldId,
  worldName: 'The Last Star',
  sourceRef: worldRef,
  viewerRelation: { state: 'connectable', connectionId: null, runtimeSourceRef: null },
  entity: {
    id: 'entity-mira',
    kind: 'person',
    name: 'Mira',
    summary: 'Mira charts the outer ring of The Last Star with Oriel Vantasse.',
    contentHash: 'entity-hash-mira',
    tags: [],
    facts: [],
  },
  characterProfile: {
    role: 'Station cartographer',
    archetype: 'Navigator of the Ming-class ring',
    traits: ['宇宙之子'],
    knowledgeTopics: ['The Outer Ring Atlas', '任意门 physics'],
    knowledgeConstraints: [],
    interactionModes: ['conversation'],
    milestones: [
      { id: 'mission', title: '任务完成', summary: 'Mira 完成了第一次任务。', sequence: 1, timeLabel: 'Cycle 12', kind: 'biography', derived: false },
      { id: 'crew', title: 'Joined Oriel Vantasse', summary: 'Mira and Oriel Vantasse chart the outer ring together.', sequence: 2, timeLabel: null, kind: 'relationship', derived: true },
      { id: 'door', title: '任意门', summary: 'Opened the 任意门 archive.', sequence: 3, timeLabel: null, kind: 'biography', derived: false },
    ],
    relationshipNotes: [],
    conversationAnchors: [],
    interaction: null,
  },
  relationships: [
    {
      id: 'rel-crewmate',
      type: 'crewmate',
      targetEntityId: 'entity-oriel',
      core: {
        presentation: { summary: 'Mira and Oriel Vantasse share the night watch.' },
        attributes: { targetLabel: 'Oriel Vantasse' },
      },
    },
    {
      id: 'rel-untyped-cosmos',
      type: '',
      targetEntityId: 'entity-cosmos',
      core: {
        presentation: { summary: '宇宙之子 is the crew nickname for Mira.' },
        attributes: { label: '宇宙之子' },
      },
    },
    {
      id: 'rel-untyped-noor',
      targetEntityId: 'entity-noor',
      core: {
        presentation: { summary: 'Noor 努尔 keeps the 任意门 archive.' },
        attributes: { targetLabel: 'Noor 努尔' },
      },
    },
  ],
};

test('non-historical English and mixed-script source detail renders as authored without guessed era or classification', () => {
  const source = toSourceDetailData(miraRaw, 'source_materialization_available');

  assert.equal(source.displayName, 'Mira');
  assert.deepEqual(
    source.relationshipClues.map((clue) => [clue.type, clue.label, clue.targetLabel]),
    [
      ['crewmate', 'Oriel Vantasse', 'Oriel Vantasse'],
      [null, '宇宙之子', null],
      [null, 'Noor 努尔', 'Noor 努尔'],
    ],
  );

  const markup = render(source);
  // Hero: the explicit role, no era badge (the archetype mentions "Ming").
  assert.doesNotMatch(markup, /data-testid="world-character-hero-dynasty-badge"/);
  assert.doesNotMatch(markup, /明代|元代|清代/);
  const description = /<p data-testid="world-character-hero-description"[^>]*>([^<]*)<\/p>/u.exec(markup)?.[1];
  assert.equal(description, 'Station cartographer');

  // English and mixed-script targets appear in the relationship map.
  const mapMarkup = sliceBetween(markup, 'data-testid="world-character-relationship-map"', 'data-testid="world-character-relationship-cards"');
  assert.match(mapMarkup, />Oriel Vantasse<\/h3>/);
  assert.match(mapMarkup, />Noor 努尔<\/h3>/);
  assert.match(mapMarkup, />宇宙之子<\/h3>/);

  // The explicit (non-historical) type is shown as authored; untyped rows are
  // shown neutrally rather than dropped or classified as kinship.
  const [crewmateCard] = cardsBy(markup, 'world-character-relationship-clue-crewmate');
  assert.match(crewmateCard ?? '', />crewmate<\/span>/);
  const untypedCards = cardsBy(markup, 'world-character-relationship-clue-untyped');
  assert.equal(untypedCards.length, 2);
  assert.match(untypedCards.join('\n'), /宇宙之子 is the crew nickname for Mira\./);
  assert.match(untypedCards.join('\n'), /Noor 努尔 keeps the 任意门 archive\./);
  for (const card of untypedCards) {
    assert.doesNotMatch(card, /Kinship|Office|Association|Status|rounded-full px-2 py-0\.5/);
  }
});

test('milestone titles such as 任务完成 and 任意门 keep their explicit kind and a relationship life event stays a relationship', () => {
  const source = toSourceDetailData(miraRaw, 'source_materialization_available');
  const milestones = composeWorldCharacterMilestones(
    source.characterProfile.milestones,
    source.worldCharacterAugmentation?.careerMilestones ?? [],
  );

  assert.deepEqual(milestones.map((milestone) => [milestone.title, milestone.kind]), [
    ['任务完成', 'biography'],
    ['Joined Oriel Vantasse', 'relationship'],
    ['任意门', 'biography'],
  ]);

  const markup = render(source);
  const timeline = sliceBetween(markup, 'data-testid="world-character-milestones-timeline"', 'data-testid="world-character-relationship-clues-section"');
  assert.match(timeline, /任务完成[\s\S]*Biography/);
  assert.match(timeline, /Joined Oriel Vantasse[\s\S]*Relationship clues/);
  assert.doesNotMatch(timeline, />Office<|>Entry<|>Kinship</);
  assert.doesNotMatch(timeline, />(?:官|仕|文|生|卒|事)<\/span>/u);
  assert.match(timeline, /Cycle 12/);
});

test('a contemporary troupe is not given an era or dynasty from 当代 or 代', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...miraRaw,
      displayName: '林导',
      worldId: 'contemporary-troupe-world',
      sourceRef: {
        ...worldRef,
        worldId: 'contemporary-troupe-world',
        worldEntityRef: { ...worldRef.worldEntityRef, worldId: 'contemporary-troupe-world' },
      },
      entity: { ...miraRaw.entity, name: '林导', summary: '当代剧团的导演，字小林，也写代码。' },
      characterProfile: {
        ...miraRaw.characterProfile,
        role: '当代剧团导演',
        archetype: '当代剧团',
      },
      relationships: [],
    }, 'source_materialization_available');
    const markup = render(source);

    assert.doesNotMatch(markup, /data-testid="world-character-hero-dynasty-badge"/);
    assert.doesNotMatch(markup, /元代|明代|清代|唐代|宋代/);
    // The hero line is the explicit role only; 字 is not parsed out of the summary.
    const description = /<p data-testid="world-character-hero-description"[^>]*>([^<]*)<\/p>/u.exec(markup)?.[1];
    assert.equal(description, '当代剧团导演');
    assert.match(markup, /当代剧团的导演，字小林，也写代码。/);
  } finally {
    await changeLocale('en');
  }
});

test('explicitly typed historical relationships still display with their localized kind', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      characterProfile: { ...ouYangDeRaw.characterProfile, relationshipNotes: [] },
      relationships: [
        ...ouYangDeRaw.relationships,
        {
          id: 'cbdb-rel-kinship-wen',
          type: 'kinship',
          sourceEntityId: 'cbdb-person-99984',
          targetEntityId: 'cbdb-person-wen-shi',
          contentHash: 'rel-kinship-wen-hash',
          core: {
            presentation: { summary: '温氏与欧阳德存在亲属关系。' },
            attributes: { targetLabel: '温氏', rowRef: 'cbdb:KINSHIP_DATA:99984:wen:1' },
          },
        },
      ],
    }, 'source_materialization_available');
    const markup = render(source);

    const [kinshipCard] = cardsBy(markup, 'world-character-relationship-clue-kinship');
    assert.match(kinshipCard ?? '', /温氏/);
    assert.match(kinshipCard ?? '', />亲属<\/span>/);
    const [statusCard] = cardsBy(markup, 'world-character-relationship-clue-status');
    assert.match(statusCard ?? '', /理学家 - 阳明学派/);
    assert.match(statusCard ?? '', />身份<\/span>/);

    // The typed office relationship becomes an office career milestone.
    const office = source.worldCharacterAugmentation?.careerMilestones.find((milestone) => milestone.title === '礼部尚书');
    assert.equal(office?.kind, 'office');
    assert.equal(office?.timeLabel, '1554');
    assert.match(markup, /礼部尚书/);
  } finally {
    await changeLocale('en');
  }
});

test('an untyped relationship row with only a summary is kept and shown neutrally', () => {
  const source = toSourceDetailData({
    ...miraRaw,
    relationships: [
      {
        id: 'rel-summary-only',
        core: { presentation: { summary: 'Shares a cabin with the octopus postman.' } },
      },
      {
        id: 'rel-empty',
        type: 'crewmate',
        core: { presentation: {}, attributes: {} },
      },
    ],
  }, 'source_materialization_available');

  assert.deepEqual(source.relationshipClues.map((clue) => [clue.id, clue.type, clue.summary]), [
    ['rel-summary-only', null, 'Shares a cabin with the octopus postman.'],
  ]);
  const markup = render(source);
  const [card] = cardsBy(markup, 'world-character-relationship-clue-untyped');
  assert.match(card ?? '', /Shares a cabin with the octopus postman\./);
  assert.doesNotMatch(markup, /centers on/);
});

test('relationship titles that equal a known entity id are treated as identifiers, not display names', () => {
  const source = toSourceDetailData({
    ...miraRaw,
    relationships: [
      {
        id: 'rel-id-label',
        type: 'crewmate',
        targetEntityId: 'entity-oriel',
        core: {
          presentation: { summary: 'Night watch partner.' },
          attributes: { targetLabel: 'entity-oriel' },
        },
      },
      {
        id: 'rel-slug-like-name',
        type: 'crewmate',
        targetEntityId: 'entity-x',
        core: {
          presentation: { summary: 'Signal officer.' },
          attributes: { targetLabel: 'the-last-star-7' },
        },
      },
    ],
  }, 'source_materialization_available');
  const markup = render(source);
  const mapMarkup = sliceBetween(markup, 'data-testid="world-character-relationship-map"', 'data-testid="world-character-relationship-cards"');

  assert.doesNotMatch(mapMarkup, />entity-oriel<\/h3>/);
  // A hyphenated value that is not a known id is authored text and is shown.
  assert.match(mapMarkup, />the-last-star-7<\/h3>/);
});
