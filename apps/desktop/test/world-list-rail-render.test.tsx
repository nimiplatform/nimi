import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Kit primitives expect React on the global object in the server-render test path.
(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { pinFollowedFirst } from '../src/shell/renderer/features/world/world-list-catalog-model';
import { WorldCatalogRail } from '../src/shell/renderer/features/world/world-list-rail';
import type { WorldListItem } from '../src/shell/renderer/features/world/world-list-model';

const world: WorldListItem = {
  id: 'world-tang-literati',
  name: '唐代文人世界',
  description: '唐代文人交游与学术资料世界。',
  tagline: null,
  motto: null,
  overview: null,
  contentRating: null,
  genre: 'historical',
  themes: ['cbdb-tang-literati-world'],
  era: '唐代',
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
  personaCount: 0,
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
    time: {
      currentWorldTime: null,
      currentLabel: null,
      eraLabel: '唐代',
      flowRatio: 1,
      isPaused: false,
    },
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

function renderRail(overrides: { worlds?: WorldListItem[] } = {}) {
  return renderToStaticMarkup(
    React.createElement(WorldCatalogRail, {
      totalCount: (overrides.worlds ?? [world]).length,
      worlds: overrides.worlds ?? [world],
      searchQuery: '',
      onSearchChange: () => {},
      sort: 'active',
      onSortChange: () => {},
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

test('world rail row renders only dynasty tags without public/source metadata', () => {
  const markup = renderRail();

  assert.match(markup, /world-rail-entry-world-tang-literati/);
  assert.match(markup, />唐代<\/span>/);
  assert.doesNotMatch(markup, /\bPublic\b/);
  assert.doesNotMatch(markup, /\bsources?\b/i);
  assert.doesNotMatch(markup, />历史<\/span>/);
  assert.doesNotMatch(markup, />朝代<\/span>/);
  assert.doesNotMatch(markup, />历史世界<\/span>/);
  assert.doesNotMatch(markup, />学术<\/span>/);
  assert.doesNotMatch(markup, />学术资料<\/span>/);
});

test('world rail row suppresses non-era preview badges derived from world identity or timeline', () => {
  const markup = renderRail({
    worlds: [{
      ...world,
      id: 'world-song-continuum',
      name: 'Song Continuum',
      era: 'Song Continuum Foundation',
      computed: {
        ...world.computed,
        time: {
          ...world.computed.time,
          eraLabel: null,
        },
      },
    }],
  });

  assert.match(markup, /Song Continuum/);
  assert.doesNotMatch(markup, /Song Continuum Foundation/);
  assert.doesNotMatch(markup, />Foundation<\/span>/);
});

test('world rail renders search and sort without the category filter', () => {
  const markup = renderRail();

  assert.match(markup, /搜索世界/);
  assert.match(markup, /排序世界/);
  assert.doesNotMatch(markup, /全部世界/);
  assert.doesNotMatch(markup, /已关注/);
  assert.doesNotMatch(markup, /趋势/);
  assert.doesNotMatch(markup, /最新/);
  assert.doesNotMatch(markup, /精选世界/);
  assert.doesNotMatch(markup, /视图模式/);
  assert.doesNotMatch(markup, /更多/);
});

test('followed worlds pin to the top of the rail ordering', () => {
  const song: WorldListItem = { ...world, id: 'world-song', name: 'Song' };
  const pinned = pinFollowedFirst([world, song], (worldId) => worldId === 'world-song');

  assert.deepEqual(pinned.map((item) => item.id), ['world-song', 'world-tang-literati']);

  const unpinned = pinFollowedFirst([world, song], () => false);
  assert.deepEqual(unpinned.map((item) => item.id), ['world-tang-literati', 'world-song']);
});
