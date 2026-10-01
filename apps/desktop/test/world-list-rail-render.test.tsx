import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Kit primitives expect React on the global object in the server-render test path.
(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { WorldCatalogRail } from '../src/shell/renderer/features/world/world-list-rail';
import type { WorldListItem } from '../src/shell/renderer/features/world/world-list-model';
import type { WorldCatalogPaging } from '../src/shell/renderer/features/world/world-list';

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

const idlePaging: WorldCatalogPaging = {
  totalCount: 1,
  hasMore: false,
  loadingMore: false,
  loadMoreFailed: false,
  offlineIncomplete: false,
  onLoadMore: () => {},
};

function renderRail(overrides: { worlds?: WorldListItem[]; searchQuery?: string; paging?: Partial<WorldCatalogPaging> } = {}) {
  const worlds = overrides.worlds ?? [world];
  const paging = { ...idlePaging, totalCount: worlds.length, ...overrides.paging };
  return renderToStaticMarkup(
    React.createElement(WorldCatalogRail, {
      totalCount: paging.totalCount,
      worlds,
      paging,
      searchQuery: overrides.searchQuery ?? '',
      onSearchChange: () => {},
      selectedWorldId: null,
      onSelectWorld: () => {},
      isFollowed: () => false,
      followAvailable: false,
      onToggleFollow: () => {},
      listEmptyLabel: '没有匹配的世界。',
    }),
  );
}

test.before(async () => {
  await initI18n();
  await changeLocale('zh');
});

test('world rail row renders the explicit lead tag without public/source metadata', () => {
  const markup = renderRail();

  assert.match(markup, /world-rail-entry-world-tang-literati/);
  assert.match(markup, />历史生活<\/span>/);
  assert.doesNotMatch(markup, /\bPublic\b/);
  assert.doesNotMatch(markup, /\bsources?\b/i);
  assert.doesNotMatch(markup, />唐代<\/span>/);
});

test('world rail row infers no tag from names, ids or time labels', () => {
  const markup = renderRail({
    worlds: [{
      ...world,
      id: 'cbdb-song-continuum-world',
      name: '当代剧团·Song Continuum',
      genre: null,
      themes: [],
      era: null,
    }],
  });

  assert.match(markup, /当代剧团·Song Continuum/);
  assert.doesNotMatch(markup, /leading-4 text-\[color:var\(--nimi-text-muted\)\]">/);
  assert.doesNotMatch(markup, />宋代<\/span>/);
  assert.doesNotMatch(markup, />乾元三年·春<\/span>/);
});

test('world rail renders server search without client sort or category filters', () => {
  const markup = renderRail();

  assert.match(markup, /搜索世界/);
  assert.doesNotMatch(markup, /world-rail-sort-menu/);
  assert.doesNotMatch(markup, /排序世界/);
  assert.doesNotMatch(markup, /全部世界/);
  assert.doesNotMatch(markup, /趋势/);
  assert.doesNotMatch(markup, /精选世界/);
  assert.doesNotMatch(markup, /视图模式/);
});

test('world rail search renders a clear button only when the query is non-empty', () => {
  const withQuery = renderRail({ searchQuery: '唐' });
  assert.match(withQuery, /data-testid="world-rail-search-clear"/);
  assert.match(withQuery, /清除搜索/);
  const emptyQuery = renderRail();
  assert.doesNotMatch(emptyQuery, /data-testid="world-rail-search-clear"/);
});

test('world rail distinguishes loaded from total and offers the next server page', () => {
  const markup = renderRail({ paging: { totalCount: 137, hasMore: true } });
  assert.match(markup, /已加载 1 \/ 共 137 个世界/);
  assert.match(markup, /data-testid="world-rail-load-more"/);
  assert.match(markup, /加载更多世界/);

  const complete = renderRail();
  assert.match(complete, /1 个世界/);
  assert.doesNotMatch(complete, /data-testid="world-rail-load-more"/);
});

test('world rail marks offline results incomplete and stops loading more', () => {
  const markup = renderRail({ paging: { totalCount: 137, hasMore: true, offlineIncomplete: true } });
  assert.match(markup, /data-testid="world-rail-offline-incomplete"/);
  assert.match(markup, /离线中：只显示已经加载的世界，结果不完整/);
  assert.doesNotMatch(markup, /data-testid="world-rail-load-more"/);
});
