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
  assert.equal(document.querySelector('.world-album-card img'), null);
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
});

test('hero uses covered creator worlds while keeping the main world in the catalog', () => {
  const document = render({}, [{ ...world, id: 'main', type: 'OASIS', bannerUrl: 'https://example.com/main.png' }, { ...world, bannerUrl: 'https://example.com/real-cover.png' }]);
  assert.equal(document.querySelector('.world-atlas-hero h2')?.textContent, world.name);
  assert.equal(document.querySelector('.world-atlas-hero img')?.getAttribute('src'), 'https://example.com/real-cover.png');
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 2);
  assert.equal(document.querySelector('[aria-label="下一个世界"]'), null);
});

test('search results omit the hero and topic shelves', () => {
  const document = render({}, [{ ...world, bannerUrl: 'https://example.com/real-cover.png' }], '唐');
  assert.equal(document.querySelector('.world-atlas-hero'), null);
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
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
    favorites onFavoritesSelect={() => {}} onTopicChange={() => {}} topicShelves={<div data-testid="topic-shelves" />}
  /></AppStoreProvider>)).window.document;
  assert.equal(document.querySelector('nav button[aria-pressed="true"]')?.textContent, '我的收藏');
  assert.equal(document.querySelectorAll('[data-testid="world-discovery-card"]').length, 1);
  assert.equal(document.querySelector('.world-atlas-hero'), null);
  assert.equal(document.querySelector('[data-testid="topic-shelves"]'), null);
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
