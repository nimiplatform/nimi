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
import { worldTimeDisplay } from '../src/shell/renderer/features/world/world-detail-paper-model';
import {
  WorldRelationshipExplorer,
  relationshipGraphEdgeLabelPosition,
} from '../src/shell/renderer/features/world/world-detail-relationship-explorer';
import { NarrativeWorldDetailPage } from '../src/shell/renderer/features/world/world-detail-template';
import { WorldSceneDetailPage } from '../src/shell/renderer/features/world/world-detail-scene-detail-page';
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
  flowRatio: 1,
  genre: '历史世界',
  era: '元代',
  themes: ['文人网络'],
  currentTimeLabel: '至元年间',
  eraLabel: '元代',
  primaryLanguage: '古典汉语',
  commonLanguages: ['古典汉语'],
};

function character(id: string, name: string, connectable: boolean): WorldCharacter {
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

const semantic: WorldSemanticData = {
  operationTitle: null,
  operationDescription: null,
  operationRules: [{ key: 'r1', title: '书院讲学', value: '以书院为核心组织讲学与交游。' }],
  powerSystems: [],
  standaloneLevels: [],
  taboos: [],
  topology: null,
  causality: null,
  languages: [{ name: '古典汉语', isCommon: true }],
  worldviewEvents: [],
  worldviewSnapshots: [],
  hasContent: true,
};

const publicAssets: WorldPublicAssetsData = {
  resourceRefs: [{ refId: 'res1', kind: 'image', purpose: 'highlight', label: '书院图' }],
  externalRefs: [{ refId: 'world-media-highlight-1', kind: 'highlight-1', uri: 'file:///tmp/nimi-forge/world/highlight-1.png' }],
  intents: [],
  scenes: [
    { id: 's1', name: '书院讲堂', description: '走进书院，了解讲学与学术交流。', activeEntities: ['姚燧'] },
    { id: 's2', name: '文人雅集', description: '参与诗会雅集。', activeEntities: [] },
  ],
};

type TestRect = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
};

function testRectFromCenter(
  center: { readonly x: number; readonly y: number },
  bounds: { readonly halfWidth: number; readonly halfHeight: number },
): TestRect {
  return {
    left: center.x - bounds.halfWidth,
    right: center.x + bounds.halfWidth,
    top: center.y - bounds.halfHeight,
    bottom: center.y + bounds.halfHeight,
  };
}

function testRectsOverlap(a: TestRect, b: TestRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test.before(async () => {
  await initI18n();
});

test('paper world detail renders narrative sections without the duplicate settings block', () => {
  const markup = renderToStaticMarkup(
    React.createElement(NarrativeWorldDetailPage, {
      world,
      characters,
      history,
      semantic,
      audits: [],
      publicAssets,
      onBack: () => {},
      onViewCharacter: () => {},
      onMaterializeSource: () => {},
    }),
  );

  // Layout + sections present.
  assert.match(markup, /data-testid="world-detail-paper-layout"/);
  assert.doesNotMatch(markup, /pointer-events:none;background:radial-gradient\(60% 50% at 0% 0%/);
  assert.match(markup, /data-testid="world-detail-paper-characters"/);
  assert.match(markup, /data-testid="world-detail-paper-materials"/);
  assert.match(markup, /data-testid="world-detail-paper-timeline"/);
  assert.match(markup, /data-testid="world-detail-paper-scenes"/);
  assert.match(markup, /data-testid="world-detail-paper-paths"/);
  // The right rail is removed — world detail is a single left column.
  assert.doesNotMatch(markup, /data-testid="world-detail-paper-rail"/);
  assert.doesNotMatch(markup, /data-testid="world-detail-paper-settings"/);

  // Resolved copy from the active locale — no raw i18n keys leak through.
  assert.match(markup, /Recommended paths/);
  assert.match(markup, /People you can meet/);
  assert.match(markup, /Popular records/);
  assert.match(markup, /River of time/);
  assert.match(markup, /Start with 姚燧/);
  assert.doesNotMatch(markup, /Primary language/);
  assert.doesNotMatch(markup, /Everything is traceable/);
  assert.doesNotMatch(markup, /WorldDetail\.paper\./);

  // Real data wired in (names, event year, scene title).
  assert.match(markup, /姚燧/);
  assert.match(markup, /1238/);
  assert.match(markup, /书院讲堂/);
  assert.match(markup, /aria-label="Open 姚燧 profile"/);
});

test('world relationship explorer dedupes repeated material clues and renders kinship in the network', async () => {
  await changeLocale('zh');
  try {
    const repeatedIntro = '元代文人书院世界，聚焦文人与书院的学术社交网络。马祖常身处其中，其仕宦经历与庞大的交游网络（与黄溍、柳贯、许有壬等关联人物）是该世界文人交流与仕宦的典型缩影。';
    const relationshipCharacters: WorldCharacter[] = [
      {
        ...character('ma-zu-chang', '马祖常', true),
        role: '文臣、文学家',
        tags: [
          repeatedIntro,
          'kinship: 祖父马世昌，家族渊源。',
          'kinship: 长子马武子，家族传承。',
          'kinship: 次子马文子，家族传承。',
          'postedToOffice: 出任御史中丞，执掌监察。',
        ],
      },
      character('huang-jin', '黄溍', true),
      character('liu-guan', '柳贯', true),
      character('xu-you-ren', '许有壬', true),
    ];

    const markup = renderToStaticMarkup(
      React.createElement(WorldRelationshipExplorer, {
        world,
        characters: relationshipCharacters,
        history,
        onBack: () => {},
        onSelectCharacter: () => {},
      }),
    );

    assert.match(markup, /data-testid="world-relationship-story-panel"/);
    assert.match(markup, /data-testid="world-relationship-kind-legend"/);
    assert.match(markup, /查看全部关系系统/);
    assert.match(markup, /亲属/);
    assert.match(markup, /马世昌/);
    assert.match(markup, /马武子/);
    assert.match(markup, /马文子/);
    assert.doesNotMatch(markup, /长子马武/);
    assert.doesNotMatch(markup, /次子马文/);
    assert.doesNotMatch(markup, /postedToOffice: 出任御史中丞/);
  } finally {
    await changeLocale('en');
  }
});

test('world relationship explorer moves short vertical edge labels out of occupied person areas', () => {
  const label = relationshipGraphEdgeLabelPosition({ x: 500, y: 372 });
  const labelRect = testRectFromCenter(label, { halfWidth: 54, halfHeight: 14 });
  const centerSafeRect = testRectFromCenter({ x: 500, y: 500 }, { halfWidth: 94, halfHeight: 94 });
  const targetSafeRect = testRectFromCenter({ x: 500, y: 372 }, { halfWidth: 102, halfHeight: 54 });

  assert.equal(testRectsOverlap(labelRect, centerSafeRect), false);
  assert.equal(testRectsOverlap(labelRect, targetSafeRect), false);
  assert.notEqual(label.x, 500);
});

test('paper world detail renders scene entry cards without inline detail-page data', () => {
  const markup = renderToStaticMarkup(
    React.createElement(NarrativeWorldDetailPage, {
      world,
      characters,
      history,
      semantic,
      audits: [],
      publicAssets,
      onBack: () => {},
      onViewCharacter: () => {},
      onMaterializeSource: () => {},
    }),
  );

  assert.match(markup, /data-testid="world-detail-paper-scene-entry-card"/);
  assert.match(markup, /file:\/\/\/tmp\/nimi-forge\/world\/highlight-1\.png/);
  assert.doesNotMatch(markup, /data-testid="world-detail-paper-scene-card"/);
  assert.doesNotMatch(markup, /Scene detail card/);
  assert.doesNotMatch(markup, /Image Asset Ref/);
  assert.doesNotMatch(markup, /Active entities/);
  assert.doesNotMatch(markup, /Related events/);
});

test('world scene detail page renders real scene, image, character, and event data after entry without modal chrome', () => {
  const page = WorldSceneDetailPage as React.ComponentType<Record<string, unknown>>;
  const markup = renderToStaticMarkup(
    React.createElement(page, {
      isOasisWorld: false,
      oasisSceneActionLabel: 'View related sources',
      onBack: () => {},
      onSelectCharacter: () => {},
      onViewCharacters: () => {},
      onViewEvents: () => {},
      relatedCharacters: [characters[0], characters[2]],
      relatedEvents: [history.items[1]],
      scene: publicAssets.scenes[0],
      sceneImageRef: publicAssets.externalRefs[0],
    }),
  );

  assert.match(markup, /data-testid="world-detail-scene-detail-page"/);
  assert.doesNotMatch(markup, /class="fixed inset-0/);
  assert.doesNotMatch(markup, /bg-black\/55/);
  assert.match(markup, /Scene detail card/);
  assert.match(markup, /s1/);
  assert.match(markup, /world-media-highlight-1/);
  assert.match(markup, /file:\/\/\/tmp\/nimi-forge\/world\/highlight-1\.png/);
  assert.match(markup, /Active entities/);
  assert.match(markup, /Related characters/);
  assert.match(markup, /Related events/);
  assert.match(markup, /姚燧/);
  assert.match(markup, /倪瓒/);
  assert.match(markup, /书院讲堂讲会/);
});

test('paper world detail hero hosts the world follow CTA without banner tags', () => {
  const markup = renderToStaticMarkup(
    React.createElement(NarrativeWorldDetailPage, {
      world,
      characters,
      history,
      semantic,
      audits: [],
      publicAssets,
      onBack: () => {},
      onViewCharacter: () => {},
      onMaterializeSource: () => {},
      onFollowWorld: () => {},
    }),
  );

  // World follow stays in the hero; low-value banner chips are omitted.
  assert.match(markup, /data-testid="world-detail-hero-world-follow"/);
  assert.doesNotMatch(markup, /data-testid="world-detail-hero-tags"/);
  assert.doesNotMatch(markup, /data-testid="world-detail-paper-rail"/);
  assert.doesNotMatch(markup, /data-testid="world-detail-paper-world-follow"/);
  // No recommended-friends rail CTA remains.
  assert.doesNotMatch(markup, /Suggested friends/);
});

test('paper world detail hides the hero follow CTA when world follow is unavailable', () => {
  const markup = renderToStaticMarkup(
    React.createElement(NarrativeWorldDetailPage, {
      world,
      characters,
      history,
      semantic,
      audits: [],
      publicAssets,
      onBack: () => {},
      onViewCharacter: () => {},
      onMaterializeSource: () => {},
    }),
  );

  assert.doesNotMatch(markup, /data-testid="world-detail-hero-world-follow"/);
  assert.doesNotMatch(markup, /data-testid="world-detail-hero-tags"/);
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
    React.createElement(NarrativeWorldDetailPage, {
      world: noisyWorld,
      characters,
      history,
      semantic,
      audits: [],
      publicAssets,
      onBack: () => {},
      onViewCharacter: () => {},
      onMaterializeSource: () => {},
    }),
  );

  assert.doesNotMatch(markup, /data-testid="world-detail-hero-tags"/);
  assert.doesNotMatch(markup, /书院交游/);
  assert.doesNotMatch(markup, /data-testid="world-detail-hero-world-time"/);
});

test('paper world detail formats ISO world time labels before rendering', () => {
  const isoWorldTime = '2026-06-28T03:32:40.159Z';
  const display = worldTimeDisplay({
    ...world,
    currentWorldTime: isoWorldTime,
    currentTimeLabel: isoWorldTime,
  });

  assert.notEqual(display, isoWorldTime);
  assert.doesNotMatch(display, /T03:32:40\.159Z/);
  assert.match(display, /2026/);
});
