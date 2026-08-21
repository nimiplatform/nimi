import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Kit primitives expect React on the global object in the server-render test path.
(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { CompactWorldCard } from '../src/shell/renderer/features/world/world-list-compact-card';
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

test.before(async () => {
  await initI18n();
  await changeLocale('zh');
});

test('compact world card renders only dynasty tags without public/source metadata', () => {
  const markup = renderToStaticMarkup(
    React.createElement(CompactWorldCard, {
      world,
      view: 'grid',
      onOpen: () => {},
    }),
  );

  assert.match(markup, />唐代<\/span>/);
  assert.doesNotMatch(markup, /\bPublic\b/);
  assert.doesNotMatch(markup, /\bsources?\b/i);
  assert.doesNotMatch(markup, />历史<\/span>/);
  assert.doesNotMatch(markup, />朝代<\/span>/);
  assert.doesNotMatch(markup, />历史世界<\/span>/);
  assert.doesNotMatch(markup, />学术<\/span>/);
  assert.doesNotMatch(markup, />学术资料<\/span>/);
});

test('compact world card suppresses non-era preview badges derived from world identity or timeline', () => {
  const markup = renderToStaticMarkup(
    React.createElement(CompactWorldCard, {
      world: {
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
      },
      view: 'grid',
      onOpen: () => {},
    }),
  );

  assert.match(markup, /Song Continuum/);
  assert.doesNotMatch(markup, /Song Continuum Foundation/);
  assert.doesNotMatch(markup, />Foundation<\/span>/);
});
