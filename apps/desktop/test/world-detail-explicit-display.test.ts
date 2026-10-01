import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Kit primitives expect React on the global object in the server-render test path.
(globalThis as { React?: typeof React }).React = React;

import { initI18n } from '../src/shell/renderer/i18n';
import { buildWorldLoreEntries } from '../src/shell/renderer/features/world/world-detail-lore-library';
import { WorldRelationshipExplorer } from '../src/shell/renderer/features/world/world-detail-relationship-explorer';
import { WorldCover } from '../src/shell/renderer/features/world/world-list-cover';
import { WORLD_NEUTRAL_COVER_BACKGROUND } from '../src/shell/renderer/features/world/world-list-theme';
import type { WorldListItem } from '../src/shell/renderer/features/world/world-list-model';
import type {
  WorldCharacter,
  WorldDetailData,
  WorldSemanticData,
} from '../src/shell/renderer/features/world/world-detail-types';
import { readyPeopleCatalog } from './world-people-catalog-fixture';

function escapeHtmlAttribute(value: string): string {
  return renderToStaticMarkup(React.createElement('span', { title: value }))
    .replace(/^<span title="/u, '')
    .replace(/"><\/span>$/u, '');
}

function listItem(name: string, overrides: Partial<WorldListItem> = {}): WorldListItem {
  return {
    id: `world-${name}`,
    name,
    description: null,
    genre: null,
    themes: [],
    era: null,
    iconUrl: null,
    bannerUrl: null,
    highlightUrls: [],
    type: 'CREATOR',
    status: 'DISCOVERABLE',
    visibility: 'public',
    entityKinds: [],
    relationshipTypes: [],
    ...overrides,
  } as WorldListItem;
}

const spaceWorld = {
  id: 'world-last-star',
  name: 'The Last Star',
  description: 'A space station at the edge of a dying star.',
  iconUrl: null,
  bannerUrl: null,
  type: 'CREATOR',
  status: 'PUBLIC',
  level: 1,
  levelUpdatedAt: null,
  characterCount: 7,
  createdAt: '2026-01-01T00:00:00.000Z',
  creatorId: null,
  freezeReason: null,
  scoreA: 0,
  scoreC: 0,
  scoreE: 0,
  scoreEwma: 0,
  scoreQ: 0,
  time: { mode: 'static', label: null, currentWorldTime: null },
} as WorldDetailData;


function character(
  id: string,
  name: string,
  overrides: Partial<WorldCharacter> = {},
): WorldCharacter {
  return {
    id,
    name,
    handle: id,
    bio: '',
    sourceRef: {
      kind: 'worldCharacter',
      id,
      worldId: spaceWorld.id,
      worldEntityRef: { kind: 'worldEntity', worldId: spaceWorld.id, entityId: `entity-${id}` },
      sourceHash: 'a'.repeat(64),
    },
    sourceKind: 'worldCharacter',
    ownership: 'worldOwned',
    relation: { state: 'connectable', connectionId: null, runtimeSourceRef: null },
    role: null,
    faction: null,
    rank: null,
    sceneName: null,
    location: null,
    traits: [],
    topics: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    avatarUrl: null,
    importance: 'SECONDARY',
    stats: null,
    ...overrides,
  };
}

test.before(async () => {
  await initI18n();
});

test('world covers use one neutral tone and never read history from names such as 当代 or 代码', () => {
  const neutral = escapeHtmlAttribute(WORLD_NEUTRAL_COVER_BACKGROUND);
  for (const world of [
    listItem('当代剧团'),
    listItem('现代都市'),
    listItem('代码工坊'),
    listItem('The Last Star', { genre: 'science fiction', themes: ['space station'] }),
    listItem('元代文人书院世界', { genre: '历史世界', era: '元代', themes: ['cbdb'] }),
  ]) {
    const markup = renderToStaticMarkup(React.createElement(WorldCover, { world }));
    assert.ok(markup.includes(neutral), `${world.name} should use the neutral cover`);
    assert.doesNotMatch(markup, /data-world-cover-tone/);
  }
});

test('world covers keep an explicit banner image', () => {
  const markup = renderToStaticMarkup(React.createElement(WorldCover, {
    world: listItem('当代剧团', { bannerUrl: 'https://cdn.example.test/troupe.png' }),
  }));
  assert.match(markup, /https:\/\/cdn\.example\.test\/troupe\.png/);
});

test('lore systems keep the neutral system icon instead of keyword-guessed institution or pathway icons', () => {
  const semantic: WorldSemanticData = {
    operationTitle: null,
    operationDescription: null,
    operationRules: [{ key: 'dock', title: 'Docking rule', value: 'Every ship docks at Ring 3.' }],
    powerSystems: [
      { name: '官制结构', description: '中央与地方官职体系', rules: ['官职与治理。'], levels: [{ name: '官职' }] },
      { name: '入仕制度', description: '科举与荐举', rules: ['记录科举、荐举、荫补。'], levels: [{ name: '科举' }] },
      { name: 'Crew promotion pathway', description: 'Career office exam', rules: ['Promotion by exam.'], levels: [] },
    ],
    standaloneLevels: [],
    taboos: [{ name: 'Open the airlock', description: 'Never during a storm.' }],
    topology: null,
    causality: null,
    languages: [{ name: 'Station Creole', category: 'spoken' }],
    worldviewEvents: [],
    worldviewSnapshots: [],
    hasContent: true,
  };

  const entries = buildWorldLoreEntries(semantic);

  assert.deepEqual(entries.map((entry) => [entry.kind, entry.icon]), [
    ['rule', 'rule'],
    ['system', 'system'],
    ['system', 'system'],
    ['system', 'system'],
    ['taboo', 'taboo'],
    ['language', 'language'],
  ]);
  assert.deepEqual(entries.map((entry) => entry.title), [
    'Docking rule',
    '官制结构',
    '入仕制度',
    'Crew promotion pathway',
    'Open the airlock',
    'Station Creole',
  ]);
});

test('relationship explorer browses every character neutrally without guessed relations, filters, or works', () => {
  const characters = [
    character('mira', 'Mira', {
      importance: 'PRIMARY',
      role: 'Station cartographer',
      faction: 'Outer Ring Guild',
      bio: 'Mira maps the outer ring of The Last Star.',
      topics: ['kinship: 父亲李嗣', '《牧庵集》', 'association: 与 Oriel Vantasse 交往'],
    }),
    character('oriel', 'Oriel Vantasse', { role: 'Station cartographer' }),
    character('noor', 'Noor 努尔', { role: '当代剧团导演', location: '任意门 archive' }),
    character('engineer', '陈工', { role: '工程师' }),
    character('mage', '艾琳', { role: '魔法师' }),
    character('chef', '老周', { role: '厨师' }),
    character('octopus', 'Inkwell', { role: 'Octopus postman', traits: ['宇宙之子'] }),
  ];

  const markup = renderToStaticMarkup(React.createElement(WorldRelationshipExplorer, {
    world: spaceWorld,
    characters,
    catalog: readyPeopleCatalog(characters.length),
    onBack: () => {},
    onSelectCharacter: () => {},
  }));

  assert.match(markup, /data-testid="world-relationship-explorer"/);
  assert.match(markup, /data-testid="world-relationship-people-panel"/);
  // Every character is listed; there are no literati/academy filter chips.
  assert.match(markup, />7 \/ 7</);
  for (const name of ['Mira', 'Oriel Vantasse', 'Noor 努尔', '陈工', '艾琳', '老周', 'Inkwell']) {
    assert.match(markup, new RegExp(`>${name}<`));
  }
  assert.doesNotMatch(markup, />Circle<|>Academy</);
  // No relationship network, kind legend, clue count, or detail panel is drawn
  // from topics, and no pseudo-person is extracted from them.
  assert.doesNotMatch(markup, /data-testid="world-relationship-story-panel"/);
  assert.doesNotMatch(markup, /data-testid="world-relationship-kind-legend"/);
  assert.doesNotMatch(markup, /data-testid="world-relationship-detail-panel"/);
  assert.doesNotMatch(markup, /data-testid="world-relationship-person-count"/);
  assert.doesNotMatch(markup, /李嗣/);
  assert.doesNotMatch(markup, /Explorable clues/);
  // Works are not parsed out of topics.
  assert.doesNotMatch(markup, /牧庵集|work clues|Same works/);
  // No relationship statistic is invented when the World publishes none.
  assert.doesNotMatch(markup, /Relationships organized/);
  // The selected profile shows explicit fields and groups only by equal role.
  assert.match(markup, /data-testid="world-relationship-profile"/);
  assert.match(markup, /Mira maps the outer ring of The Last Star\./);
  assert.match(markup, /Station cartographer/);
  assert.match(markup, /Same identity/);
  assert.doesNotMatch(markup, /Contemporaries/);
});

test('relationship explorer searches and pages the Realm people catalog instead of the first page', () => {
  const loaded = [
    character('mira', 'Mira', { role: 'Station cartographer' }),
    character('oriel', 'Oriel Vantasse', { role: 'Station cartographer' }),
  ];
  const render = (catalog: ReturnType<typeof readyPeopleCatalog>) => renderToStaticMarkup(
    React.createElement(WorldRelationshipExplorer, {
      world: spaceWorld,
      characters: loaded,
      catalog,
      onBack: () => {},
      onSelectCharacter: () => {},
    }),
  );

  const paged = render(readyPeopleCatalog(105, { hasMore: true, query: 'cartographer' }));
  // The search box holds the server query; the count is loaded / catalog total, not the page size.
  assert.match(paged, /value="cartographer"/);
  assert.match(paged, />2 \/ 105</);
  assert.match(paged, />105</);
  assert.match(paged, /data-testid="world-detail-people-load-more"/);
  assert.match(paged, /2 of 105 loaded/);

  const failed = render(readyPeopleCatalog(0, { status: 'error' }));
  assert.match(failed, /data-testid="world-people-catalog-error"/);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /data-testid="world-relationship-profile"/);
  assert.doesNotMatch(failed, / \/ 0</);
});
