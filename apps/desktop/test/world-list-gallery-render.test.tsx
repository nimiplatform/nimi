import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { WorldCatalogContent, type WorldCatalogPaging } from '../src/shell/renderer/features/world/world-list.js';
import { ExploreSectionNav } from '../src/shell/renderer/features/explore/explore-section-nav.js';
import { WorldAlbumCard, WorldAtlasHero, WorldDiscoveryCard } from '../src/shell/renderer/features/world/world-atlas.js';
import type { WorldListItem } from '../src/shell/renderer/features/world/world-list-model.js';

(globalThis as { React?: typeof React }).React = React;
const world: WorldListItem = {
  id: 'world-tang-literati',
  name: '唐代文人世界',
  description: '唐代文人交游与学术资料世界。',
  tagline: null,
  motto: null,
  overview: null,
  contentRating: null,
  genre: '历史生活',
  themes: ['草堂'],
  era: '唐',
  iconUrl: null,
  bannerUrl: null,
  highlightUrls: [],
  type: 'CREATOR',
  status: 'DISCOVERABLE',
  visibility: 'public',
  entityKinds: [],
  relationshipTypes: [],
  level: 1,
  levelUpdatedAt: null,
  entityCount: 0,
  relationshipCount: 0,
  characterCount: 80,
  personaCharacterCount: 0,
  sceneCount: 0,
  systemCount: 0,
  timelineEventCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  creatorId: null,
  freezeReason: null,
  scoreA: 0,
  scoreC: 0,
  scoreE: 0,
  scoreEwma: 0,
  scoreQ: 0,
  computed: {
    time: { mode: 'static', label: '乾元三年·春', currentWorldTime: null },
    languages: {
      primary: null,
      common: [],
    },
    entry: {
      recommendedCharacters: [],
    },
    score: {
      scoreEwma: 0,
    },
    featuredCharacterCount: 0,
  },
};


const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
const paging: WorldCatalogPaging = { totalCount: 137, hasMore: true, loadingMore: false, loadMoreFailed: false, offlineIncomplete: false, onLoadMore() {} };
const render = (overrides: Partial<WorldCatalogPaging> = {}, worlds = [world], query = '') => new JSDOM(renderToStaticMarkup(
  <AppStoreProvider store={store}><WorldCatalogContent worlds={worlds} paging={{ ...paging, ...overrides }} searchQuery={query} /></AppStoreProvider>,
)).window.document;
test.before(async () => { await initI18n(); await changeLocale('zh'); });

test('world gallery shows typed summaries and keeps the server total separate from loaded worlds', () => {
  const document = render();
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
  assert.ok(document.body.textContent?.includes('137 个世界'));
  assert.ok(document.body.textContent?.includes('唐代文人世界'));
  assert.ok(document.querySelector('button[aria-label="探索唐代文人世界"]'));
  assert.ok(document.querySelector('[data-testid="world-catalog-load-more"]'));
  assert.equal(document.querySelector('[data-testid="world-detail-discovery"]'), null);
});

test('world gallery combines section tabs, count, search and partner discovery in one header', () => {
  const document = new JSDOM(renderToStaticMarkup(
    <AppStoreProvider store={store}><WorldCatalogContent
      worlds={[world]} paging={paging}
      headerLeading={<ExploreSectionNav active="worlds" onSelect={() => {}} />}
      headerTrailing={<button>发现伙伴</button>}
    /></AppStoreProvider>,
  )).window.document;
  const header = document.querySelector('.world-atlas-header-combined');
  assert.ok(header?.querySelector('[data-testid="explore-section-nav"]'));
  assert.equal(header?.querySelector('.world-atlas-count')?.textContent, '137 个世界');
  assert.ok(header?.querySelector('input'));
  assert.equal(header?.querySelector('h1'), null);
  assert.equal(header?.querySelector('.world-atlas-tools')?.lastElementChild?.textContent, '发现伙伴');
});

test('world layouts preserve reviewed copy while discovery cards show only the name', () => {
  const reviewedWorld = {
    ...world,
    name: '拆了演武场赔不起，我和宿敌连夜组队抢奖金',
    tagline: '第18次约架拆了军校最豪华的演武场，背上五百万巨债的你和死对头姜燎被迫绑死组队，拉上毒舌改装师程野，开启一边打爆全国联赛抢奖金、一边抠门算账的疯狗夺冠路！',
  };
  for (const layout of [
    <WorldAtlasHero worlds={[reviewedWorld]} />,
    <WorldAlbumCard world={reviewedWorld} />,
  ]) {
    const document = new JSDOM(renderToStaticMarkup(<AppStoreProvider store={store}>{layout}</AppStoreProvider>)).window.document;
    assert.equal(document.querySelector('h2, h3')?.textContent, reviewedWorld.name);
    assert.deepEqual(Array.from(document.querySelectorAll('p')).map(node => node.textContent), [reviewedWorld.tagline]);
    assert.ok(!document.body.textContent?.includes('80 位人物'));
  }
  const discoveryDocument = new JSDOM(renderToStaticMarkup(<AppStoreProvider store={store}><WorldDiscoveryCard world={reviewedWorld} /></AppStoreProvider>)).window.document;
  assert.equal(discoveryDocument.querySelector('h3')?.textContent, reviewedWorld.name);
  assert.equal(discoveryDocument.querySelector('p'), null);
  const searchDocument = render({}, [world], '唐');
  assert.equal(searchDocument.querySelector('.world-album-caption p')?.textContent, world.description);
});

test('world gallery preserves returned order and does not filter loaded rows again', () => {
  const document = render({}, [{ ...world, id: 'world-b', name: '另一个世界' }, world], '唐');
  assert.deepEqual(Array.from(document.querySelectorAll('h2[title]')).map((heading) => heading.textContent), ['另一个世界', world.name]);
  assert.equal(document.querySelector('input')?.value, '唐');
});

test('offline incomplete catalog states its limit and does not expose another page', () => {
  const document = render({ offlineIncomplete: true });
  assert.ok(document.body.textContent?.includes('结果不完整'));
  assert.equal(document.querySelector('[data-testid="world-catalog-load-more"]'), null);
});

test('topic filters remain available during loading and errors without showing old worlds', () => {
  for (const state of [{ loading: true }, { error: true }]) {
    const document = new JSDOM(renderToStaticMarkup(<AppStoreProvider store={store}><WorldCatalogContent
      worlds={[world]} paging={paging} {...state}
      topics={[{ id: 'history', title: '历史长卷', titleEn: 'History' }]} topicId="history" onTopicChange={() => {}}
    /></AppStoreProvider>)).window.document;
    assert.ok(document.querySelector('nav[aria-label="专题"] button[aria-pressed="true"]'));
    assert.ok(document.querySelector('input'));
    assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 0);
  }
});

test('unassigned worlds remain in all worlds without inferred topic rows or invented covers', () => {
  const document = render();
  assert.equal(document.querySelector('.world-atlas-hero'), null);
  assert.equal(document.querySelector('.world-atlas-shelf'), null);
  assert.equal(document.querySelector('.world-discovery-card img'), null);
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
});

test('hero uses covered creator worlds while keeping the main world in the catalog', () => {
  const document = render({}, [{ ...world, id: 'main', type: 'OASIS', bannerUrl: 'https://example.com/main.png' }, { ...world, bannerUrl: 'https://example.com/real-cover.png' }]);
  assert.equal(document.querySelector('.world-atlas-hero h2')?.textContent, world.name);
  assert.equal(document.querySelector('.world-atlas-hero img')?.getAttribute('src'), 'https://example.com/real-cover.png');
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
  assert.equal(document.querySelector('[aria-label="下一个世界"]'), null);
});

test('search results omit the hero', () => {
  const document = render({}, [{ ...world, bannerUrl: 'https://example.com/real-cover.png' }], '唐');
  assert.equal(document.querySelector('.world-atlas-hero'), null);
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
});

test('discovery removes only spotlight worlds from exploration', () => {
  const worlds = [
    { ...world, id: 'main', type: 'OASIS', bannerUrl: 'https://example.com/main.png' },
    { ...world, id: 'uncovered' },
    ...['first', 'second', 'third'].map(id => ({ ...world, id, name: id, bannerUrl: `https://example.com/${id}.png`, tagline: `Introduction to ${id}` })),
  ];
  const document = render({}, worlds);
  assert.deepEqual(Array.from(document.querySelectorAll('.world-discovery-grid h3')).map(node => node.textContent), worlds.slice(0, 2).map(item => item.name));
  assert.equal(document.querySelector('.world-discovery-grid p'), null);
  assert.equal(document.querySelector('section[aria-label="为你精选的世界"]'), null);
  assert.ok(document.querySelector('section[aria-label="探索更多世界"]'));
});

test('exploration cards use the taller hero rendition instead of the cropped card rendition', () => {
  const media: NonNullable<WorldListItem['bannerMedia']> = {
    resourceId: 'resource-cover', contentVersion: 'a'.repeat(64), publicationGeneration: 1, policyVersion: 'policy-v1',
    expiresAt: null, previewUrl: null, originalUrl: null, video: null,
    images: ['card', 'hero'].map((purpose) => ({
      purpose: purpose as 'card' | 'hero',
      families: [{ mimeType: 'image/png', sources: [{ url: `https://example.com/${purpose}-640.png`, width: 640, height: purpose === 'card' ? 264 : 427, mimeType: 'image/png' }] }],
    })),
  };
  const document = new JSDOM(renderToStaticMarkup(
    <AppStoreProvider store={store}><WorldDiscoveryCard world={{ ...world, bannerMedia: media }} /></AppStoreProvider>,
  )).window.document;
  const image = document.querySelector('.world-discovery-card img');
  assert.equal(image?.getAttribute('src'), 'https://example.com/hero-640.png');
  assert.equal(image?.getAttribute('width'), '640');
  assert.equal(image?.getAttribute('height'), '427');
});

test('spotlight leads resolve outside the first page and stay out of exploration after pagination', () => {
  const leads = [
    { ...world, id: 'z01', name: '季风之眼：云端标本船', bannerUrl: 'https://example.com/monsoon.png' },
    { ...world, id: 'd10', name: '春风得意行', bannerUrl: 'https://example.com/spring.png' },
    { ...world, id: 'cwe-b03-u09', name: '红土大满贯：混双搭档是刚分手的前任，卫冕冠军在场边等我摔拍子', bannerUrl: 'https://example.com/tennis.png' },
    { ...world, id: 'thinink-plains', name: '薄墨平原', bannerUrl: 'https://example.com/plains.png' },
    { ...world, id: 'z03', name: '雾峡灯塔与鲸骨邮局', bannerUrl: 'https://example.com/lighthouse.png' },
  ];
  const catalog = Array.from({ length: 8 }, (_, index) => ({ ...world, id: `catalog-${index}`, name: `Catalog ${index}`, bannerUrl: `https://example.com/${index}.png` }));
  for (const worlds of [catalog, [...catalog, ...leads]]) {
    const document = new JSDOM(renderToStaticMarkup(<AppStoreProvider store={store}><WorldCatalogContent
      worlds={worlds} leadWorlds={[...leads].reverse()} paging={paging}
    /></AppStoreProvider>)).window.document;
    assert.deepEqual(Array.from(document.querySelectorAll('.world-atlas-hero-dots button')).map(node => node.getAttribute('aria-label')), [
      '查看季风之眼：云端标本船', '查看春风得意行',
      '查看红土大满贯：混双搭档是刚分手的前任，卫冕冠军在场边等我摔拍子', '查看薄墨平原', '查看雾峡灯塔与鲸骨邮局',
    ]);
    assert.equal(document.querySelector('.world-atlas-hero h2')?.textContent, leads[0]!.name);
    assert.deepEqual(Array.from(document.querySelectorAll('.world-discovery-grid h3')).map(node => node.textContent), catalog.map(item => item.name));
    assert.ok(document.querySelector('[data-testid="world-catalog-load-more"]'));
  }
});

test('spotlight-only loading and errors leave the catalog available without excluding undisplayed worlds', () => {
  const worlds = Array.from({ length: 4 }, (_, index) => ({ ...world, id: `world-${index}`, name: `World ${index}`, bannerUrl: `https://example.com/${index}.png` }));
  for (const state of [{ spotlightLoading: true }, { spotlightError: true }]) {
    const document = new JSDOM(renderToStaticMarkup(<AppStoreProvider store={store}><WorldCatalogContent
      worlds={worlds} paging={paging} {...state}
    /></AppStoreProvider>)).window.document;
    assert.equal(document.querySelector('.world-atlas-hero'), null);
    assert.deepEqual(Array.from(document.querySelectorAll('.world-discovery-grid h3')).map(node => node.textContent), worlds.map(item => item.name));
  }
});

test('canonical world navigation restores the originating people query after source detail', async () => {
  const navigation = createHomeNavigation();
  await navigation.push({ id: 'world-detail', worldId: 'world-1', search: '采薇' });
  const sourceRef = { kind: 'worldCharacter' as const, id: 'character-1', worldId: 'world-1', worldEntityRef: { kind: 'worldEntity' as const, worldId: 'world-1', entityId: 'entity-1' }, sourceHash: 'a'.repeat(64) };
  assert.equal((await navigation.push({ id: 'source-detail', sourceRef })).status, 'committed');
  await navigation.back();
  assert.deepEqual(navigation.getSnapshot().current.destination, { id: 'world-detail', worldId: 'world-1', search: '采薇' });
});


test('world catalog navigation preserves its topic and independent search when returning from a world', async () => {
  const navigation = createHomeNavigation();
  await navigation.push({ id: 'explore', exploreSection: 'worlds', search: 'persona query', worldSearch: '富春', worldTopicId: 'history' });
  await navigation.push({ id: 'world-detail', worldId: 'world-1' });
  await navigation.back();
  assert.deepEqual(navigation.getSnapshot().current.destination, { id: 'explore', exploreSection: 'worlds', search: 'persona query', worldSearch: '富春', worldTopicId: 'history' });
});

test('favorites navigation preserves the collection and its search when returning from detail', async () => {
  const navigation = createHomeNavigation();
  await navigation.push({ id: 'explore', exploreSection: 'worlds', worldCollection: 'favorites', worldSearch: '唐' });
  await navigation.push({ id: 'world-detail', worldId: world.id });
  await navigation.back();
  assert.equal(navigation.getSnapshot().current.destination.worldCollection, 'favorites');
  assert.equal(navigation.getSnapshot().current.destination.worldSearch, '唐');
});

test('favorites show the saved world grid without discovery shelves and keep the collection selected', () => {
  const document = new JSDOM(renderToStaticMarkup(<AppStoreProvider store={store}><WorldCatalogContent
    worlds={[{ ...world, bannerUrl: 'https://example.com/cover.png' }]} paging={{ ...paging, totalCount: 1, hasMore: false }}
    favorites onFavoritesSelect={() => {}} onTopicChange={() => {}}
  /></AppStoreProvider>)).window.document;
  assert.equal(document.querySelector('nav button[aria-pressed="true"]')?.textContent, '我的收藏');
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
  assert.equal(document.querySelector('.world-atlas-hero'), null);
  assert.equal(document.querySelector('[data-testid="world-catalog-load-more"]'), null);
});

test('favorites distinguish empty, signed-out, and partially unavailable collections', () => {
  for (const [props, message] of [
    [{}, '还没有收藏的世界'],
    [{ favoritesUnavailable: 'World.favorites.signIn' }, '登录后查看你在本机的收藏'],
    [{ favoritesPartialError: true, worlds: [world] }, '部分收藏的世界暂时无法加载。'],
  ] as const) {
    const document = new JSDOM(renderToStaticMarkup(<AppStoreProvider store={store}><WorldCatalogContent
      worlds={[]} paging={{ ...paging, hasMore: false }} favorites {...props}
    /></AppStoreProvider>)).window.document;
    assert.ok(document.body.textContent?.includes(message));
    assert.equal(document.body.textContent?.includes('暂无公开世界'), false);
    if ('favoritesPartialError' in props) assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
  }
});
