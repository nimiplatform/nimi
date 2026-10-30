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
import { worldReadingEntries, worldReadingProseBlocks } from '../src/shell/renderer/features/world/world-detail-reading-model';
import { worldTimeDisplay } from '../src/shell/renderer/features/world/world-detail-paper-model';
import { derivedScenes } from '../src/shell/renderer/features/world/world-detail-template-model';
import { WorldRelationshipExplorer } from '../src/shell/renderer/features/world/world-detail-relationship-explorer';
import {
  WorldDetailPage,
  worldDetailRootSectionScrollTop,
} from '../src/shell/renderer/features/world/world-detail-template';
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

test('world reader groups explicit rules, systems, and languages in source order', () => {
  const entries = worldReadingEntries(world, semantic, emptyHistory).filter((entry) => entry.section !== 'description');

  assert.deepEqual(entries.map((entry) => entry.section), ['rules', 'systems', 'languages']);
  assert.equal(entries[0]?.title, '书院讲学');
  assert.deepEqual(entries[0]?.body, ['以书院为核心组织讲学与交游。']);
  assert.equal(entries[1]?.title, '文人交游体系');
  assert.deepEqual(entries[1]?.body, ['人物之间通过书信、拜访、诗文唱和形成关系网络。', '交游关系必须来自公开资料。']);
  assert.deepEqual(entries[2]?.text, ['古典汉语']);
});

test('world reader preserves system descriptions, rules, and explicit level labels', () => {
  const entries = worldReadingEntries(world, institutionSemantic, emptyHistory).filter((entry) => entry.section === 'systems');

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.title, '官制结构');
  assert.deepEqual(entries[0]?.body, [
    '中央与地方官职体系',
    '涵盖元代中央与地方各级官职，帮助理解文人的仕宦经历与身份位置。',
    '官职', '仕宦', '地方治理',
  ]);
  assert.equal(entries[1]?.title, '入仕制度');
  assert.deepEqual(entries[1]?.body, [
    '士人如何进入官场',
    '记录科举、荐举、荫补等方式，帮助理解人物的上升路径与社会流动。',
    '科举', '荐举', '荫补',
  ]);
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

test('world discovery puts source profiles ahead of the about and places sections', () => {
  const html = renderToStaticMarkup(<WorldDetailPage world={world} characters={characters} peopleCharacters={characters} peopleCatalog={readyPeopleCatalog(105, { hasMore: true })} history={history} semantic={semantic} audits={[]} publicAssets={publicAssets} onViewCharacter={() => {}} />);
  const document = new JSDOM(html).window.document;
  const people = document.querySelector('#world-detail-characters')!;
  const about = document.querySelector('[data-testid="world-detail-about"]')!;
  assert.ok(people.compareDocumentPosition(about) & 4, 'people precede the about section');
  assert.ok(about.textContent?.includes('文人交游体系'), 'the about section shows world systems');
  assert.ok(about.textContent?.includes('人物之间通过书信、拜访、诗文唱和形成关系网络。'), 'the about section shows full system descriptions');
  assert.ok(about.textContent?.includes('交游关系必须来自公开资料。'), 'the about section shows every system rule');
  const places = document.querySelector('[data-testid="world-detail-scenes"]')!;
  assert.ok(people.compareDocumentPosition(places) & 4, 'people precede the places section');
  assert.ok(places.textContent?.includes('书院讲堂'));
  assert.equal(places.querySelectorAll('[data-testid="world-scene-row"]').length, 2);
  assert.ok(places.querySelector('button[aria-label="View 姚燧"]'), 'place rows list related people inline');
  assert.ok(places.querySelector('button[aria-label="View 倪瓒"]'), 'place rows list related people inline');
  assert.equal(people.querySelectorAll('[data-testid="world-person-card"]').length, characters.length);
  assert.equal(people.querySelectorAll('button[aria-label^="View "]').length, characters.length);
  assert.ok(people.textContent?.includes('105 people'));
  assert.ok(!people.querySelector('[data-testid="world-detail-people-view-all"]'), 'every person is listed inline without a view-all page');
  assert.ok(people.querySelector('[data-testid="world-detail-people-load-more"]'), 'the inline catalog keeps cursor paging');
  assert.doesNotMatch(document.body.textContent!, /Become my partner|Chat now|Recommended paths|WorldDetail\./);
});

test('world discovery presents people with identity metadata and a short biography', () => {
  const galleryCharacters = [{
    ...characters[0],
    ageDescription: '三十岁上下',
    role: '退役特种工程兵',
    faction: null,
    bio: '外表冷峻寡言，实则用一身烟火气守护身边重要的人。',
  }, ...characters.slice(1)];
  const html = renderToStaticMarkup(<WorldDetailPage world={world} characters={galleryCharacters} peopleCharacters={galleryCharacters} peopleCatalog={readyPeopleCatalog(galleryCharacters.length)} history={history} semantic={semantic} audits={[]} publicAssets={publicAssets} onViewCharacter={() => {}} />);
  const document = new JSDOM(html).window.document;
  const card = document.querySelector('[data-testid="world-person-card"]')!;

  assert.equal(card.querySelector('[data-testid="world-person-meta"]')?.textContent, '三十岁上下 | 退役特种工程兵');
  assert.equal(card.querySelector('[data-testid="world-person-bio"]')?.textContent, galleryCharacters[0].bio);
});

test('world discovery renders avatar-only managed media with the issued avatar purpose', () => {
  const avatarMedia: NonNullable<WorldCharacter['avatarMedia']> = {
    resourceId: 'avatar-1',
    contentVersion: 'a'.repeat(64),
    publicationGeneration: 1,
    policyVersion: 'v1',
    expiresAt: null,
    previewUrl: null,
    originalUrl: 'https://media.example/avatar-original.bin',
    images: [{
      purpose: 'avatar',
      families: [{
        mimeType: 'image/webp',
        sources: [{ url: 'https://media.example/avatar-256.webp', width: 256, height: 256, mimeType: 'image/webp' }],
      }],
    }],
    video: null,
  };
  const galleryCharacters = [{ ...characters[0], avatarMedia }];
  const html = renderToStaticMarkup(<WorldDetailPage world={world} characters={galleryCharacters} peopleCharacters={galleryCharacters} peopleCatalog={readyPeopleCatalog(galleryCharacters.length)} history={history} semantic={semantic} audits={[]} publicAssets={publicAssets} onViewCharacter={() => {}} />);
  const document = new JSDOM(html).window.document;
  const image = document.querySelector('[data-testid="world-person-card"] img');

  assert.equal(image?.getAttribute('src'), 'https://media.example/avatar-256.webp');
  assert.equal(image?.getAttribute('srcset'), 'https://media.example/avatar-256.webp 256w');
  assert.equal(image?.getAttribute('width'), '256');
  assert.equal(image?.getAttribute('height'), '256');
  assert.ok(!image?.className.includes('aspect-'), 'the avatar keeps its original aspect ratio');
});

test('long description and system paragraphs remain full prose in the reader and on the homepage', () => {
  const description = '世界中的每个人都有自己的日常。'.repeat(50);
  const system = '这个世界的社会和生活运转规则。'.repeat(100);
  const longWorld = { ...world, overview: null, description, bannerUrl: 'https://example.test/world.png' };
  const longSemantic = { ...semantic, powerSystems: [{ name: system, description: system, levels: [], rules: [] }] };
  const html = renderToStaticMarkup(<WorldDetailPage world={longWorld} characters={characters} peopleCharacters={characters} peopleCatalog={readyPeopleCatalog(characters.length)} history={history} semantic={longSemantic} audits={[]} publicAssets={publicAssets} />);
  const document = new JSDOM(html).window.document;
  const summary = document.querySelector('[data-testid="world-detail-summary"]')!;
  assert.equal(summary.textContent, description, 'a single-paragraph summary renders in full');
  assert.ok(!summary.getAttribute('class')?.includes('line-clamp'), 'the summary is never clamped mid-paragraph');
  const multiWorld = { ...longWorld, description: `完整的第一段。\n\n${description}` };
  const multiDocument = new JSDOM(renderToStaticMarkup(<WorldDetailPage world={multiWorld} characters={characters} peopleCharacters={characters} peopleCatalog={readyPeopleCatalog(characters.length)} history={history} semantic={longSemantic} audits={[]} publicAssets={publicAssets} />)).window.document;
  assert.equal(multiDocument.querySelector('[data-testid="world-detail-summary"]')?.textContent, '完整的第一段。', 'a multi-paragraph summary shows the whole first paragraph only');
  const banner = document.querySelector('[data-testid="world-detail-banner"]');
  const bannerFrame = document.querySelector('[data-testid="world-detail-banner-frame"]');
  assert.equal(banner?.tagName, 'IMG');
  assert.ok(banner?.className.includes('h-auto'), 'other worlds keep their original banner aspect ratio');
  assert.ok(!bannerFrame?.className.includes('aspect-[16/9]'), 'other worlds do not use the compact banner frame');
  assert.ok(!banner?.className.includes('object-contain'), 'other worlds do not use the contained banner treatment');
  assert.ok(document.querySelector('[data-testid="world-detail-open-reader"]'));
  const about = document.querySelector('[data-testid="world-detail-about"]')!;
  assert.ok(about.textContent?.includes(system), 'the about section shows world systems in full on the homepage');
  assert.equal(about.textContent!.split(system).length - 1, 1, 'a system paragraph repeated as name and description renders once');
  assert.ok(Array.from(document.querySelectorAll('h1,h2,h3')).every((heading) => !heading.textContent?.includes(system)));
  const entries = worldReadingEntries(longWorld, longSemantic, history);
  assert.ok(entries.find((entry) => entry.section === 'description')?.text.includes(description));
  assert.deepEqual(entries.find((entry) => entry.section === 'systems')?.text, [system]);
});

test('the x01 world keeps its complete portrait banner inside a compact frame', () => {
  const containedWorld = { ...world, id: 'x01', bannerUrl: 'https://example.test/world.png' };
  const html = renderToStaticMarkup(<WorldDetailPage world={containedWorld} characters={[]} peopleCharacters={[]} peopleCatalog={readyPeopleCatalog(0)} history={emptyHistory} semantic={emptySemantic} audits={[]} publicAssets={publicAssets} />);
  const document = new JSDOM(html).window.document;
  const banner = document.querySelector('[data-testid="world-detail-banner"]');
  const bannerFrame = document.querySelector('[data-testid="world-detail-banner-frame"]');
  assert.ok(bannerFrame?.className.includes('aspect-[16/9]'), 'x01 uses the compact landscape frame');
  assert.ok(banner?.className.includes('object-contain'), 'x01 shows the complete image without cropping');
});

test('world following remains a single secondary action and disappears when unavailable', () => {
  const render = (follow?: () => void) => new JSDOM(renderToStaticMarkup(<WorldDetailPage world={world} characters={[]} peopleCharacters={[]} peopleCatalog={readyPeopleCatalog(0)} history={emptyHistory} semantic={emptySemantic} audits={[]} publicAssets={publicAssets} onFollowWorld={follow} worldFollowed />)).window.document;
  const followed = render(() => {});
  const button = followed.querySelector('[data-testid="world-detail-follow-world"]');
  assert.equal(button?.getAttribute('aria-pressed'), 'true');
  assert.equal(button?.getAttribute('aria-label'), 'Remove from favorites');
  assert.equal(button?.textContent?.trim(), '', 'the follow action is icon-only');
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

test('the reading model promotes short labels without duplicating prose', () => {
  const entries = worldReadingEntries(world, semantic, history);
  const system = entries.find((entry) => entry.section === 'systems')!;
  assert.equal(system.title, '文人交游体系', 'a short system name leads its entry');
  assert.ok(!system.body.includes('文人交游体系'), 'the promoted title leaves the body');
  assert.ok(system.text.includes('文人交游体系'), 'the flattened content keeps the name once');
  const rule = entries.find((entry) => entry.id === 'rule-0')!;
  assert.equal(rule.title, '书院讲学');
  assert.deepEqual(rule.body, ['以书院为核心组织讲学与交游。']);
  const dated = entries.find((entry) => entry.id === 'event-ev1')!;
  assert.equal(dated.time, '1238', 'a dated event exposes its time node');
  assert.equal(dated.title, '姚燧出生');
  assert.deepEqual(dated.body, ['姚燧生于洛阳，自幼随许衡问学。', '日后成为元代文坛领袖的姚燧生于洛阳。']);
  const description = entries.find((entry) => entry.section === 'description')!;
  assert.equal(description.title, undefined, 'long-form description never promotes an entry title');
  assert.deepEqual(description.body, description.text);
});

test('long paragraphs repeated as name and description stay body text', () => {
  const paragraph = '这个世界的社会和生活运转规则。'.repeat(20);
  const entries = worldReadingEntries({ ...world, overview: null }, { ...emptySemantic, powerSystems: [{ name: paragraph, description: paragraph, levels: [], rules: [] }] }, emptyHistory);
  const system = entries.find((entry) => entry.section === 'systems')!;
  assert.equal(system.title, undefined, 'a full paragraph is never a heading');
  assert.deepEqual(system.body, [paragraph], 'the prose renders once as body');
  const shortOnly = worldReadingEntries(world, { ...emptySemantic, taboos: [{ name: '禁止私斗' }] }, emptyHistory);
  const taboo = shortOnly.find((entry) => entry.section === 'taboos')!;
  assert.equal(taboo.title, undefined, 'a lone label with no following prose stays body text');
  assert.deepEqual(taboo.body, ['禁止私斗']);
});

test('prose blocks surface supplied content headings without altering text', () => {
  const prose = '坊墙之内的晨昏与门户\n朱雀大街两侧坊墙环绕，晨鼓开门、暮鼓闭坊。\n两市喧闹与各色营生\n东市西市商贾云集，驼铃与叫卖声彻夜不绝。';
  assert.deepEqual(worldReadingProseBlocks(prose), [
    { kind: 'heading', text: '坊墙之内的晨昏与门户' },
    { kind: 'paragraph', text: '朱雀大街两侧坊墙环绕，晨鼓开门、暮鼓闭坊。' },
    { kind: 'heading', text: '两市喧闹与各色营生' },
    { kind: 'paragraph', text: '东市西市商贾云集，驼铃与叫卖声彻夜不绝。' },
  ]);
  assert.deepEqual(worldReadingProseBlocks('第一段。\n\n第二段。'), [
    { kind: 'paragraph', text: '第一段。' },
    { kind: 'paragraph', text: '第二段。' },
  ], 'blank lines only separate paragraphs');
  assert.deepEqual(worldReadingProseBlocks('短句\n短句\n更短').every((block) => block.kind === 'paragraph'), true, 'consecutive short lines never become headings');
  assert.deepEqual(worldReadingProseBlocks('完整段落，收束于句读。\n残句').map((block) => block.kind), ['paragraph', 'paragraph'], 'a trailing short line stays a paragraph');
  assert.deepEqual(worldReadingProseBlocks('完整段落，收束于句读。\n未完待续').map((block) => block.kind), ['paragraph', 'paragraph']);
});

test('failed supplemental content stays explicit while character discovery remains usable', () => {
  const document = new JSDOM(renderToStaticMarkup(<WorldDetailPage world={world} characters={characters} peopleCharacters={characters} peopleCatalog={readyPeopleCatalog(characters.length)} history={emptyHistory} semantic={emptySemantic} audits={[]} publicAssets={{ scenes: [], resourceRefs: [], externalRefs: [], intents: [] }} readingIncomplete publicAssetsIncomplete onRetryReading={() => {}} onViewCharacter={() => {}} />)).window.document;
  assert.ok(document.body.textContent?.includes('Some world settings or history could not be loaded'));
  assert.ok(document.body.textContent?.includes('Some scenes or illustrations could not be loaded'));
  assert.equal(document.querySelectorAll('button[aria-label^="View "]').length, characters.length);
});

test('world stories use their existing Markdown and expose one reading action after the excerpt', async () => {
  const setting = '# 原文世界\n\n## 第一节\n\n### 真实的小标题\n\n第一段原文。\n\n第二段原文。\n\n第三段原文。\n\n第四段留给完整阅读。\n\n## 第二节\n\n后面的原文。';
  const storyWorld = { ...world, name: '原文世界', setting };
  const assets = { scenes: [], resourceRefs: [], externalRefs: [], intents: [] };
  const props = { world: storyWorld, characters, peopleCharacters: characters, peopleCatalog: readyPeopleCatalog(characters.length), history: emptyHistory, semantic: emptySemantic, audits: [], publicAssets: assets };
  const document = new JSDOM(renderToStaticMarkup(<WorldDetailPage {...props} />)).window.document;
  const excerpt = document.querySelector('[data-testid="world-story-excerpt"]')!;
  assert.equal(excerpt.querySelector('h3')?.textContent, '真实的小标题');
  assert.ok(excerpt.textContent?.includes('第三段原文。'));
  assert.ok(!excerpt.textContent?.includes('第四段留给完整阅读。'));
  assert.equal(document.querySelectorAll('[data-testid="world-detail-open-reader"]').length, 1);
  assert.ok(document.querySelector('[data-testid="world-detail-story"] [data-testid="world-detail-open-reader"]'));
  assert.ok(!document.querySelector('[data-testid="world-detail-overview"] [data-testid="world-detail-open-reader"]'));
  assert.ok(!document.querySelector('[data-testid="world-detail-illustrations"]'));
  assert.ok(!document.querySelector('[data-testid="world-detail-scenes"]'));
  assert.ok(!document.querySelector('[data-testid="world-detail-about"]'));
  const reader = new JSDOM(renderToStaticMarkup(<WorldDetailPage {...props} initialSubpage="reader" />)).window.document;
  assert.ok(reader.querySelector('main[data-testid="world-detail-reader"]'));
  assert.equal(reader.querySelector('[role="dialog"]'), null);
  assert.ok(reader.querySelector('[data-testid="world-story-document"]')?.textContent?.includes('第四段留给完整阅读。'));
  assert.ok(reader.body.textContent?.includes('后面的原文。'));
  assert.equal(reader.querySelector('[data-testid="world-detail-discovery"]'), null);
});

test('Markdown headings stay faithful through code fences, duplicate titles and unsafe embedded content', async () => {
  const { WorldStoryMarkdown } = await import('../src/shell/renderer/features/world/world-story-markdown.js');
  const content = '# 标题\n\n```text\n## 不是目录\n```\n\n## 相同标题\n\n保留 **加粗** 和列表。\n\n- 第一项\n- 第二项\n\n## 相同标题\n\n[危险链接](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![来源说明](https://example.test/unissued.png)';
  const document = new JSDOM(renderToStaticMarkup(<WorldStoryMarkdown content={content} title="标题" />)).window.document;
  const headings = [...document.querySelectorAll('[data-world-heading]')];
  assert.deepEqual(headings.map((node) => node.textContent), ['相同标题', '相同标题']);
  assert.equal(new Set(headings.map((node) => node.id)).size, 2);
  assert.ok(document.querySelector('pre')?.textContent?.includes('## 不是目录'));
  assert.equal(document.querySelector('strong')?.textContent, '加粗');
  assert.equal(document.querySelectorAll('li').length, 2);
  assert.equal(document.querySelector('script, img, a[href^="javascript:"]'), null);
  assert.ok(document.body.textContent?.includes('来源说明'));
});

test('world reading participates in Home back and forward navigation without losing the people query', async () => {
  const { createHomeNavigation } = await import('../src/shell/renderer/app-shell/providers/home-navigation.js');
  const navigation = createHomeNavigation();
  try {
    const detail = { id: 'world-detail' as const, worldId: 'world-1', search: '姚' };
    assert.equal((await navigation.push(detail)).status, 'committed');
    assert.equal((await navigation.push({ ...detail, worldSubpage: 'reader' })).status, 'committed');
    assert.equal(navigation.getSnapshot().current.destination.worldSubpage, 'reader');
    await navigation.back();
    assert.deepEqual(navigation.getSnapshot().current.destination, detail);
    await navigation.forward();
    assert.equal(navigation.getSnapshot().current.destination.worldSubpage, 'reader');
    assert.equal(navigation.getSnapshot().current.destination.search, '姚');
  } finally { navigation.dispose(); }
});

test('the reading journey restores overview scroll and resets it for another world', async () => {
  const { act, createRef } = await import('react');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const viewport = createRef<HTMLDivElement>();
  dom.window.HTMLElement.prototype.scrollTo = function (options) { this.scrollTop = (options as ScrollToOptions).top ?? 0; };
  let jumpedTo = '';
  dom.window.HTMLElement.prototype.scrollIntoView = function () { jumpedTo = this.id; };
  const nextFrame = () => new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
  const storyWorld = { ...world, setting: '# 世界\n\n## 第一节\n\n第一段。\n\n## 第二节\n\n第二段。' };
  const render = (id: string) => <div ref={viewport}><WorldDetailPage world={{ ...storyWorld, id }} characters={[]} peopleCharacters={[]} peopleCatalog={readyPeopleCatalog(0)} history={emptyHistory} semantic={emptySemantic} audits={[]} publicAssets={{ scenes: [], resourceRefs: [], externalRefs: [], intents: [] }} rootScrollViewportRef={viewport} /></div>;
  try {
    await act(async () => { root.render(render('world-1')); });
    await act(nextFrame);
    viewport.current!.scrollTop = 180;
    await act(async () => { (dom.window.document.querySelector('[data-testid="world-detail-open-reader"]') as HTMLButtonElement).click(); });
    await act(nextFrame);
    assert.equal(viewport.current!.scrollTop, 0);
    assert.ok(dom.window.document.querySelector('main[data-testid="world-detail-reader"]'));
    const chapter = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[data-testid="world-reader-contents"] button')].find((button) => button.textContent === '第二节')!;
    await act(async () => chapter.click());
    assert.ok(jumpedTo.startsWith('world-story-heading-'));
    assert.equal(dom.window.document.activeElement?.textContent, '第二节');
    const back = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Back to world')!;
    await act(async () => back.click());
    await act(nextFrame);
    assert.equal(viewport.current!.scrollTop, 180);
    assert.ok(dom.window.document.querySelector('[data-testid="world-detail-discovery"]'));
    await act(async () => { root.render(render('world-2')); });
    await act(nextFrame);
    assert.equal(viewport.current!.scrollTop, 0);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
