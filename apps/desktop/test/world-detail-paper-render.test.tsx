/**
 * World detail paper-surface render proof.
 *
 * Mounts the redesigned paper world-detail page with mock world data through
 * the real i18n instance and asserts every section renders with resolved
 * copy — no missing translation keys, no undefined-access crash. Effects do
 * not run under `renderToStaticMarkup`, so this covers the static structure
 * and translation wiring of the new surface.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ScrollArea / radix CJS primitives expect a global `React`.
(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { JSDOM } from 'jsdom';
import { worldReadingEntries } from '../src/shell/renderer/features/world/world-detail-reading-model';
import { worldTimeDisplay } from '../src/shell/renderer/features/world/world-detail-paper-model';
import { derivedScenes } from '../src/shell/renderer/features/world/world-detail-template-model';
import {
  WorldLoreLibraryPage,
  buildWorldLoreEntries,
} from '../src/shell/renderer/features/world/world-detail-lore-library';
import {
  WorldResourceReferencesPage,
  buildWorldResourceReferenceEntries,
} from '../src/shell/renderer/features/world/world-detail-resource-references';
import { WorldRelationshipExplorer } from '../src/shell/renderer/features/world/world-detail-relationship-explorer';
import {
  WorldDetailPage,
  worldDetailRootSectionScrollTop,
} from '../src/shell/renderer/features/world/world-detail-template';
import { WorldSceneDetailPage } from '../src/shell/renderer/features/world/world-detail-scene-detail-page';
import { readyPeopleCatalog } from './world-people-catalog-fixture';
import type { WorldCharacter, WorldDetailData, WorldHistoryBundle, WorldPublicAssetsData, WorldSemanticData } from '../src/shell/renderer/features/world/world-detail-types';

const world: WorldDetailData = {
  id: 'world-1',
  name: '元代文人书院世界',
  description: '一个由元代士人共同编织的知识网络与交游世界。',
  tagline: '探索元代士人的交游、仕宦与著述网络',
  motto: null,
  overview: '本世界聚焦元代士人群体的学术社交网络，以书院、交游、仕宦与著述为核心线索。',
  contentRating: null,
  iconUrl: null,
  bannerUrl: null,
  type: 'CREATOR',
  status: 'PUBLIC',
  level: 3,
  levelUpdatedAt: null,
  characterCount: 50,
  createdAt: '2026-01-01T00:00:00.000Z',
  creatorId: null,
  freezeReason: null,
  scoreA: 0,
  scoreC: 0,
  scoreE: 0,
  scoreEwma: 0,
  scoreQ: 0,
  time: { mode: 'static', label: '至元年间', currentWorldTime: null },
  genre: '历史世界',
  era: '元代',
  themes: ['文人网络'],
  primaryLanguage: '古典汉语',
  commonLanguages: ['古典汉语'],
};

function character(
  id: string,
  name: string,
  connectable: boolean,
  topics: readonly string[] = [],
): WorldCharacter {
  return {
    id,
    name,
    handle: `@${id}`,
    bio: `${name} 的生平简介。`,
    sourceRef: { kind: 'worldCharacter', worldId: 'world-1', characterId: id } as unknown as WorldCharacter['sourceRef'],
    sourceKind: 'worldCharacter',
    ownership: 'worldOwned',
    relation: { state: connectable ? 'connectable' : 'unavailable' },
    role: '书院讲学者',
    faction: '文人交游圈',
    sceneName: '书院讲堂',
    location: '洛阳',
    topics,
    createdAt: '2026-01-01T00:00:00.000Z',
    avatarUrl: null,
    importance: 'PRIMARY',
    stats: { engagementCount: 12, vitalityScore: 88 },
  };
}

const characters: WorldCharacter[] = [
  character('yao', '姚燧', true),
  character('tong', '同恕', true),
  character('ni', '倪瓒', false),
];

const history: WorldHistoryBundle = {
  items: [
    {
      id: 'ev1', timelineSeq: 1, time: '1238', title: '姚燧出生', tag: '人物',
      description: '日后成为元代文坛领袖的姚燧生于洛阳。', level: 'PRIMARY', eventHorizon: 'PAST',
      summary: '姚燧生于洛阳，自幼随许衡问学。', cause: null, process: null, result: null,
      locationRefs: ['洛阳'], characterRefs: ['姚燧'], evidenceRefs: [], confidence: 1, needsEvidence: false,
    },
    {
      id: 'ev2', timelineSeq: 2, time: '1260', title: '书院讲堂讲会', tag: '场景',
      description: '书院讲堂成为士人讲学、研讨和诗文唱和的公共场景。', level: 'PRIMARY', eventHorizon: 'PAST',
      summary: '书院讲堂承载讲学与雅集。', cause: null, process: null, result: null,
      locationRefs: ['书院讲堂'], characterRefs: ['姚燧', '倪瓒'], evidenceRefs: [], confidence: 1, needsEvidence: false,
    },
  ],
  summary: { primaryCount: 2, secondaryCount: 0, totalCount: 2, eventCharacterCoverage: 1, eventLocationCoverage: 1 },
};

const emptyHistory: WorldHistoryBundle = {
  items: [],
  summary: null,
};

const semantic: WorldSemanticData = {
  operationTitle: null,
  operationDescription: null,
  operationRules: [{ key: 'r1', title: '书院讲学', value: '以书院为核心组织讲学与交游。' }],
  powerSystems: [{
    name: '文人交游体系',
    description: '人物之间通过书信、拜访、诗文唱和形成关系网络。',
    levels: [],
    rules: ['交游关系必须来自公开资料。'],
  }],
  standaloneLevels: [],
  taboos: [],
  topology: null,
  causality: null,
  languages: [{ name: '古典汉语', isCommon: true }],
  worldviewEvents: [],
  worldviewSnapshots: [],
  hasContent: true,
};

const emptySemantic: WorldSemanticData = {
  ...semantic,
  operationRules: [],
  powerSystems: [],
  standaloneLevels: [],
  taboos: [],
  languages: [],
  hasContent: false,
};

const institutionSemantic: WorldSemanticData = {
  ...emptySemantic,
  powerSystems: [
    {
      name: '官制结构',
      description: '中央与地方官职体系',
      rules: ['涵盖元代中央与地方各级官职，帮助理解文人的仕宦经历与身份位置。'],
      levels: [
        { name: '官职' },
        { name: '仕宦' },
        { name: '地方治理' },
      ],
    },
    {
      name: '入仕制度',
      description: '士人如何进入官场',
      rules: ['记录科举、荐举、荫补等方式，帮助理解人物的上升路径与社会流动。'],
      levels: [
        { name: '科举' },
        { name: '荐举' },
        { name: '荫补' },
      ],
    },
  ],
  hasContent: true,
};

const publicAssets = {
  resourceRefs: [{ refId: 'res1', kind: 'image', purpose: 'highlight', label: '书院图' }],
  externalRefs: [{ refId: 'world-media-highlight-1', kind: 'highlight-1', uri: 'file:///tmp/nimi-forge/world/highlight-1.png' }],
  intents: [{ intentId: 'intent-map', kind: 'map', summary: '世界地图与场景定位用图。' }],
  scenes: [
    {
      id: 's1',
      name: '书院讲堂',
      description: '走进书院，了解讲学与学术交流。',
      activeEntities: [
        { id: 'entity-yao', kind: 'person', label: '姚燧', summary: '讲学主持者。' },
        { id: 'entity-ni', kind: 'person', label: '倪瓒', summary: '参与雅集者。' },
      ],
      relatedCharacters: [characters[0], characters[2]],
      relatedEvents: [{
        id: 'ev2',
        timelineSeq: 2,
        time: '1260',
        title: '书院讲堂讲会',
        tag: '场景',
        description: '书院讲堂成为士人讲学、研讨和诗文唱和的公共场景。',
        level: 'PRIMARY',
        eventHorizon: 'PAST',
        summary: '书院讲堂承载讲学与雅集。',
        cause: null,
        process: null,
        result: null,
        locationRefs: ['书院讲堂'],
        characterRefs: ['姚燧', '倪瓒'],
        evidenceRefs: [],
        confidence: 1,
        needsEvidence: false,
      }],
      relatedResources: [{
        id: 'resource-academy',
        kind: 'entity',
        title: '书院讲堂',
        summary: '讲学与雅集发生的地点。',
        entityRefs: ['entity-yao', 'entity-ni'],
        eventRefs: ['ev2'],
      }],
      counts: {
        activeEntityCount: 2,
        relatedCharacterCount: 2,
        relatedEventCount: 1,
        relatedResourceCount: 1,
      },
      media: [],
    },
    {
      id: 's2',
      name: '文人雅集',
      description: '参与诗会雅集。',
      activeEntities: [],
      relatedCharacters: [],
      relatedEvents: [],
      relatedResources: [],
      counts: {
        activeEntityCount: 0,
        relatedCharacterCount: 0,
        relatedEventCount: 0,
        relatedResourceCount: 0,
      },
      media: [],
    },
  ],
} as unknown as WorldPublicAssetsData;

test.before(async () => {
  await initI18n();
});

test('derived scenes never place characters from tag or topic text', () => {
  const sceneAssets = {
    ...publicAssets,
    scenes: [{
      id: 'yuan-literati-network',
      name: '文人交游网络',
      description: '呈现元代文人之间通过书信、拜访、诗文酬唱等方式建立的广泛社会联系。',
      activeEntities: [],
      relatedCharacters: [],
      relatedEvents: [],
      relatedResources: [],
      counts: {
        activeEntityCount: 0,
        relatedCharacterCount: 0,
        relatedEventCount: 0,
        relatedResourceCount: 0,
      },
      media: [],
    }],
  } as unknown as WorldPublicAssetsData;

  const scenes = derivedScenes(sceneAssets, semantic);

  // Scene participants come only from explicit Realm scene references.
  assert.equal(scenes[0]?.relatedCharacters.length, 0);
  assert.equal(scenes[0]?.counts.relatedCharacterCount, 0);
});



test('semantic lore library derives grouped entries from world semantic data', () => {
  const entries = buildWorldLoreEntries(semantic);

  assert.deepEqual(entries.map((entry) => entry.kind), ['rule', 'system', 'language']);
  assert.equal(entries[0]?.title, '书院讲学');
  assert.equal(entries[0]?.body, '以书院为核心组织讲学与交游。');
  assert.equal(entries[1]?.title, '文人交游体系');
  assert.equal((entries[1] as { subtitle?: string } | undefined)?.subtitle, '人物之间通过书信、拜访、诗文唱和形成关系网络。');
  assert.equal(entries[1]?.body, '交游关系必须来自公开资料。');
  assert.deepEqual(entries[1]?.details, []);
  assert.equal(entries[2]?.title, '古典汉语');
});

test('semantic lore overview derives reusable card fields from world systems', () => {
  const entries = buildWorldLoreEntries(institutionSemantic);

  assert.deepEqual(entries.map((entry) => entry.kind), ['system', 'system']);
  assert.equal(entries[0]?.title, '官制结构');
  assert.equal((entries[0] as { subtitle?: string } | undefined)?.subtitle, '中央与地方官职体系');
  assert.equal(entries[0]?.body, '涵盖元代中央与地方各级官职，帮助理解文人的仕宦经历与身份位置。');
  assert.deepEqual((entries[0] as { keywords?: readonly string[] } | undefined)?.keywords, ['官职', '仕宦', '地方治理']);
  assert.equal(entries[1]?.title, '入仕制度');
  assert.equal((entries[1] as { subtitle?: string } | undefined)?.subtitle, '士人如何进入官场');
  assert.equal(entries[1]?.body, '记录科举、荐举、荫补等方式，帮助理解人物的上升路径与社会流动。');
  assert.deepEqual((entries[1] as { keywords?: readonly string[] } | undefined)?.keywords, ['科举', '荐举', '荫补']);
});




test('world lore library page renders semantic groups as browseable records', async () => {
  await changeLocale('zh');
  try {
    const markup = renderToStaticMarkup(
      React.createElement(WorldLoreLibraryPage, {
        world,
        semantic,
        onBack: () => {},
      }),
    );

    assert.match(markup, /data-testid="world-detail-lore-library-page"/);
    assert.match(markup, /世界设定集/);
    assert.match(markup, /运行规则/);
    assert.match(markup, /制度与体系/);
    assert.match(markup, /语言与表达/);
    assert.match(markup, /书院讲学/);
    assert.match(markup, /以书院为核心组织讲学与交游。/);
    assert.match(markup, /文人交游体系/);
    assert.match(markup, /交游关系必须来自公开资料。/);
    assert.match(markup, /古典汉语/);
    assert.doesNotMatch(markup, /WorldDetail\.paper\.loreLibrary/);
  } finally {
    await changeLocale('en');
  }
});

test('resource references page reorganizes resource data around user-ready assets', async () => {
  const entries = buildWorldResourceReferenceEntries(publicAssets);

  assert.deepEqual(entries.map((entry) => entry.kind), ['material', 'material', 'intent']);
  assert.deepEqual(entries.map((entry) => entry.status), ['registered', 'external', 'planned']);
  assert.equal(entries[0]?.title, '书院图');
  assert.equal(entries[0]?.subtitle, 'highlight / image');
  assert.equal(entries[1]?.role, 'highlight');
  assert.equal(entries[1]?.roleIndex, 1);
  assert.equal(entries[1]?.externalUri, 'file:///tmp/nimi-forge/world/highlight-1.png');
  assert.equal(entries[2]?.title, '');
  assert.equal(entries[2]?.role, 'map');
  assert.equal(entries[2]?.body, '世界地图与场景定位用图。');

  await changeLocale('zh');
  try {
    const markup = renderToStaticMarkup(
      React.createElement(WorldResourceReferencesPage, {
        world,
        publicAssets,
        onBack: () => {},
      }),
    );

    assert.match(markup, /data-testid="world-detail-resource-references-page"/);
    assert.match(markup, /世界素材清单/);
    assert.match(markup, /可打开素材/);
    assert.match(markup, /已接入素材/);
    assert.match(markup, /待补齐计划/);
    assert.match(markup, /仅有内部记录/);
    assert.match(markup, /仅有来源链接/);
    assert.match(markup, /书院图/);
    assert.match(markup, /亮点图 1/);
    assert.match(markup, /地图\/定位图/);
    assert.match(markup, /res1/);
    assert.match(markup, /world-media-highlight-1/);
    assert.match(markup, /intent-map/);
    assert.match(markup, /file:\/\/\/tmp\/nimi-forge\/world\/highlight-1\.png/);
    assert.match(markup, /世界地图与场景定位用图。/);
    assert.doesNotMatch(markup, /资源引用集/);
    assert.doesNotMatch(markup, /规范资源/);
    assert.doesNotMatch(markup, /WorldDetail\.paper\.resourceReferences/);
  } finally {
    await changeLocale('en');
  }
});

test('world relationship explorer lists people without inventing relationships from topic text', async () => {
  await changeLocale('zh');
  try {
    const relationshipCharacters: WorldCharacter[] = [
      {
        ...character('ma-zu-chang', '马祖常', true),
        role: '文臣、文学家',
        topics: [
          'kinship: 祖父马世昌，家族渊源。',
          'postedToOffice: 出任御史中丞，执掌监察。',
          '《石田文集》',
        ],
      },
      character('huang-jin', '黄溍', true),
      character('liu-guan', '柳贯', true),
    ];

    const markup = renderToStaticMarkup(
      React.createElement(WorldRelationshipExplorer, {
        world,
        characters: relationshipCharacters,
        catalog: readyPeopleCatalog(relationshipCharacters.length),
        onBack: () => {},
        onSelectCharacter: () => {},
      }),
    );

    assert.match(markup, /data-testid="world-relationship-people-panel"/);
    assert.match(markup, /data-testid="world-relationship-profile"/);
    assert.match(markup, /马祖常/);
    assert.match(markup, /黄溍/);
    assert.match(markup, /柳贯/);
    assert.doesNotMatch(markup, /data-testid="world-relationship-story-panel"/);
    assert.doesNotMatch(markup, /data-testid="world-relationship-kind-legend"/);
    assert.doesNotMatch(markup, /马世昌/);
    assert.doesNotMatch(markup, /御史中丞/);
    assert.doesNotMatch(markup, /石田文集/);
  } finally {
    await changeLocale('en');
  }
});


test('world detail computes scene section centering inside the scroll viewport', () => {
  const scrollTop = worldDetailRootSectionScrollTop({
    placement: 'center',
    viewportScrollTop: 300,
    viewportTop: 0,
    viewportHeight: 900,
    targetTop: 1200,
    targetHeight: 500,
  });

  assert.equal(scrollTop, 1300);
  assert.equal(300 + 1200 - scrollTop + 250, 450);
});

test('world scene detail page renders structured scene DTO data after entry without modal chrome', () => {
  const page = WorldSceneDetailPage as React.ComponentType<Record<string, unknown>>;
  const markup = renderToStaticMarkup(
    React.createElement(page, {
      isOasisWorld: false,
      oasisSceneActionLabel: 'View related sources',
      onBack: () => {},
      onSelectCharacter: () => {},
      onViewCharacters: () => {},
      onViewEvents: () => {},
      relatedCharacters: [],
      relatedEvents: [],
      scene: publicAssets.scenes[0],
      sceneImageRef: publicAssets.externalRefs[0],
    }),
  );

  assert.match(markup, /data-testid="world-detail-scene-detail-page"/);
  assert.doesNotMatch(markup, /class="fixed inset-0/);
  assert.doesNotMatch(markup, /bg-black\/55/);
  assert.match(markup, /Scene detail card/);
  assert.match(markup, /file:\/\/\/tmp\/nimi-forge\/world\/highlight-1\.png/);
  assert.match(markup, /Active entities/);
  assert.match(markup, /Related characters/);
  assert.match(markup, /Related events/);
  assert.match(markup, /姚燧/);
  assert.match(markup, /倪瓒/);
  assert.match(markup, /书院讲堂讲会/);
  assert.match(markup, /讲学与雅集发生的地点。/);
  assert.doesNotMatch(markup, /Scene ID/);
  assert.doesNotMatch(markup, /Image Asset Ref/);
  assert.doesNotMatch(markup, /world-media-highlight-1/);
  assert.doesNotMatch(markup, /from locationRefs and summaries/);
  assert.doesNotMatch(markup, /from scene resources/);
  assert.doesNotMatch(markup, /View related sources/);
});

test('world scene detail page hides empty counters, provenance and resource chrome', () => {
  const page = WorldSceneDetailPage as React.ComponentType<Record<string, unknown>>;
  const sparseScene = {
    ...publicAssets.scenes[1],
    relatedCharacters: characters,
    counts: {
      activeEntityCount: 0,
      relatedCharacterCount: characters.length,
      relatedEventCount: 0,
      relatedResourceCount: 0,
    },
  };
  const markup = renderToStaticMarkup(
    React.createElement(page, {
      isOasisWorld: false,
      oasisSceneActionLabel: 'View related sources',
      onBack: () => {},
      onSelectCharacter: () => {},
      onViewCharacters: () => {},
      onViewEvents: () => {},
      scene: sparseScene,
      sceneImageRef: publicAssets.externalRefs[0],
    }),
  );

  assert.match(markup, /Related characters/);
  assert.match(markup, /姚燧/);
  assert.doesNotMatch(markup, /Active entities/);
  assert.doesNotMatch(markup, /Related events/);
  assert.doesNotMatch(markup, /Related resources/);
  assert.doesNotMatch(markup, /from locationRefs and summaries/);
  assert.doesNotMatch(markup, /from scene resources/);
  assert.doesNotMatch(markup, /Scene ID/);
  assert.doesNotMatch(markup, /Image Asset Ref/);
  assert.doesNotMatch(markup, /s2/);
  assert.doesNotMatch(markup, /world-media-highlight-1/);
  assert.doesNotMatch(markup, /View related sources/);
  assert.doesNotMatch(markup, /View related characters/);
  assert.doesNotMatch(markup, /Before entering, note what is here/);
});



test('paper world detail hero omits banner tags even when metadata has display tags', () => {
  const noisyWorld: WorldDetailData = {
    ...world,
    status: 'DISCOVERABLE',
    genre: '历史世界',
    era: '元代',
    themes: [
      'Discoverable',
      '3 Source',
      '1.00x 时间流速',
      '2026-06-29T04:19:52.000Z',
      'source://realm/world-1',
      '文人网络',
      '书院交游',
    ],
    currentTimeLabel: '2026-06-29T04:19:52.000Z',
  };

  const markup = renderToStaticMarkup(
    React.createElement(WorldDetailPage, {
      world: noisyWorld,
      characters,
      peopleCharacters: characters,
      peopleCatalog: readyPeopleCatalog(characters.length),
      history,
      semantic,
      audits: [],
      publicAssets,
      onBack: () => {},
      onViewCharacter: () => {},
    }),
  );

  assert.doesNotMatch(markup, /data-testid="world-detail-hero-tags"/);
  assert.doesNotMatch(markup, /书院交游/);
  assert.doesNotMatch(markup, /data-testid="world-detail-hero-world-time"/);
});

test('paper world detail shows only the label of a static world', () => {
  assert.equal(worldTimeDisplay({ mode: 'static', label: '第三次退潮', currentWorldTime: null }, String), '第三次退潮');
  assert.equal(worldTimeDisplay({ mode: 'static', label: null, currentWorldTime: null }, String), null);
});

test('paper world detail formats ISO wall-clock world time labels before rendering', () => {
  const isoWorldTime = '2026-06-28T03:32:40.159Z';
  const display = worldTimeDisplay({
    mode: 'wallClockAnchored',
    currentWorldTime: isoWorldTime,
    currentLabel: isoWorldTime,
    anchorLabel: 'June 2026',
    flowRatio: 1,
    isPaused: false,
  }, (value) => new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(String(value))));

  assert.notEqual(display, isoWorldTime);
  assert.doesNotMatch(display ?? '', /T03:32:40\.159Z/);
  assert.match(display ?? '', /2026/);
});

test('world discovery puts source profiles ahead of bounded setting previews', () => {
  const html = renderToStaticMarkup(<WorldDetailPage world={world} characters={characters} peopleCharacters={characters} peopleCatalog={readyPeopleCatalog(105, { hasMore: true })} history={history} semantic={semantic} audits={[]} publicAssets={publicAssets} onViewCharacter={() => {}} />);
  const document = new JSDOM(html).window.document;
  const people = document.querySelector('#world-detail-characters')!;
  const settings = document.querySelector('[data-testid="world-detail-settings-preview"]')!;
  assert.ok(people.compareDocumentPosition(settings) & 4, 'people precede the setting');
  assert.equal(people.querySelectorAll('[data-testid="world-character-card"]').length, characters.length);
  assert.equal(people.querySelectorAll('button[aria-label^="View "]').length, characters.length);
  assert.ok(people.textContent?.includes('105 people'));
  assert.ok(people.querySelector('[data-testid="world-detail-people-load-more"]'));
  assert.doesNotMatch(document.body.textContent!, /Become my partner|Chat now|Recommended paths|WorldDetail\./);
});

test('long description and system paragraphs remain full prose in the reader and bounded on the homepage', () => {
  const description = '世界中的每个人都有自己的日常。'.repeat(50);
  const system = '这个世界的社会和生活运转规则。'.repeat(100);
  const longWorld = { ...world, overview: null, description, bannerUrl: 'https://example.test/world.png' };
  const longSemantic = { ...semantic, powerSystems: [{ name: system, description: system, levels: [], rules: [] }] };
  const html = renderToStaticMarkup(<WorldDetailPage world={longWorld} characters={characters} peopleCharacters={characters} peopleCatalog={readyPeopleCatalog(characters.length)} history={history} semantic={longSemantic} audits={[]} publicAssets={publicAssets} />);
  const document = new JSDOM(html).window.document;
  const summary = document.querySelector('[data-testid="world-detail-summary"]')!;
  assert.equal(summary.textContent, description);
  assert.ok(summary.classList.contains('line-clamp-2'));
  assert.equal(document.querySelector('[data-testid="world-detail-banner"]')?.tagName, 'IMG');
  assert.ok(document.querySelector('[data-testid="world-detail-open-reader"]'));
  assert.ok(Array.from(document.querySelectorAll('h1,h2,h3')).every((heading) => !heading.textContent?.includes(system)));
  const entries = worldReadingEntries(longWorld, longSemantic, history);
  assert.ok(entries.find((entry) => entry.section === 'description')?.text.includes(description));
  assert.deepEqual(entries.find((entry) => entry.section === 'systems')?.text, [system]);
});

test('world following remains a single secondary action and disappears when unavailable', () => {
  const render = (follow?: () => void) => new JSDOM(renderToStaticMarkup(<WorldDetailPage world={world} characters={[]} peopleCharacters={[]} peopleCatalog={readyPeopleCatalog(0)} history={emptyHistory} semantic={emptySemantic} audits={[]} publicAssets={publicAssets} onFollowWorld={follow} worldFollowed />)).window.document;
  const followed = render(() => {});
  const button = followed.querySelector('[data-testid="world-detail-follow-world"]');
  assert.equal(button?.getAttribute('aria-pressed'), 'true');
  assert.equal(followed.querySelectorAll('[data-testid="world-detail-follow-world"]').length, 1);
  assert.equal(render().querySelector('[data-testid="world-detail-follow-world"]'), null);
});

test('the full world reader does not lose levels or realms beyond old visual-card limits', () => {
  const levels = Array.from({ length: 14 }, (_, index) => ({ name: `Level ${index}`, description: `Level description ${index}` }));
  const realms = Array.from({ length: 10 }, (_, index) => ({ name: `Realm ${index}`, description: `Realm description ${index}`, accessibility: `Access ${index}` }));
  const entries = worldReadingEntries(world, { ...emptySemantic, powerSystems: [{ name: 'System', levels, rules: ['System rule'] }], topology: { realms } }, emptyHistory);
  const system = entries.find((entry) => entry.section === 'systems')!;
  const topology = entries.find((entry) => entry.section === 'topology')!;
  assert.ok(system.text.includes('Level 13\nLevel description 13'));
  assert.ok(topology.text.includes('Realm 9\nRealm description 9\nAccess 9'));
});

test('failed supplemental content stays explicit while character discovery remains usable', () => {
  const document = new JSDOM(renderToStaticMarkup(<WorldDetailPage world={world} characters={characters} peopleCharacters={characters} peopleCatalog={readyPeopleCatalog(characters.length)} history={emptyHistory} semantic={emptySemantic} audits={[]} publicAssets={{ scenes: [], resourceRefs: [], externalRefs: [], intents: [] }} readingIncomplete publicAssetsIncomplete onRetryReading={() => {}} onViewCharacter={() => {}} />)).window.document;
  assert.ok(document.body.textContent?.includes('Some world setting or history could not be loaded'));
  assert.ok(document.body.textContent?.includes('Places and references could not be loaded'));
  assert.equal(document.querySelectorAll('button[aria-label^="View "]').length, characters.length);
});
