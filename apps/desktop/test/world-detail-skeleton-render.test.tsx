/**
 * World / source detail loading-skeleton render proof.
 *
 * Asserts the loading branches of the world detail page and the source
 * detail page render structured skeleton surfaces (pulse placeholder blocks)
 * instead of blank panels or plain loading text.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ScrollArea / radix CJS primitives expect a global `React`.
(globalThis as { React?: typeof React }).React = React;

import { initI18n } from '../src/shell/renderer/i18n';
import {
  NarrativeWorldDetailPage,
  WorldDetailLoadingState,
  type WorldDetailPageProps,
} from '../src/shell/renderer/features/world/world-detail-template';
import {
  WorldLoreLibrarySkeleton,
  WorldPeopleArchiveSkeleton,
  WorldRelationshipExplorerSkeleton,
} from '../src/shell/renderer/features/world/world-detail-skeletons';
import { SourceDetailView } from '../src/shell/renderer/features/source-detail/source-detail-view';
import type { SourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model';

await initI18n();

const loadingPageProps = {
  world: null,
  characters: [],
  history: { items: [], summary: null },
  semantic: {
    operationTitle: null,
    operationDescription: null,
    operationRules: [],
    powerSystems: [],
    standaloneLevels: [],
    taboos: [],
    topology: null,
    causality: null,
    languages: [],
    worldviewEvents: [],
    worldviewSnapshots: [],
    hasContent: false,
  },
  audits: [],
  publicAssets: { resourceRefs: [], externalRefs: [], intents: [], scenes: [] },
  loading: true,
} as unknown as WorldDetailPageProps;

test('world detail page renders the paper skeleton while the composite query is loading', () => {
  const markup = renderToStaticMarkup(<NarrativeWorldDetailPage {...loadingPageProps} />);
  assert.match(markup, /data-testid="world-detail-page-skeleton"/);
  assert.match(markup, /animate-pulse/);
  assert.match(markup, /aria-busy="true"/);
});

test('world detail loading state export renders the same skeleton surface', () => {
  const markup = renderToStaticMarkup(<WorldDetailLoadingState />);
  assert.match(markup, /data-testid="world-detail-page-skeleton"/);
});

test('world detail subpage skeletons render pulse placeholder structures', () => {
  const relationship = renderToStaticMarkup(<WorldRelationshipExplorerSkeleton />);
  assert.match(relationship, /data-testid="world-relationship-explorer-skeleton"/);
  assert.match(relationship, /animate-pulse/);

  const people = renderToStaticMarkup(<WorldPeopleArchiveSkeleton />);
  assert.match(people, /data-testid="world-detail-people-archive-skeleton"/);
  assert.match(people, /animate-pulse/);

  const lore = renderToStaticMarkup(<WorldLoreLibrarySkeleton />);
  assert.match(lore, /data-testid="world-detail-lore-library-skeleton"/);
  assert.match(lore, /animate-pulse/);
});

test('source detail view renders the dossier skeleton while loading', () => {
  const markup = renderToStaticMarkup(
    <SourceDetailView
      source={null as unknown as SourceDetailData}
      loading
      error={false}
      onBack={() => {}}
      onOpenWorld={() => {}}
      onPrimaryAction={() => {}}
    />,
  );
  assert.match(markup, /data-testid="source-detail-skeleton"/);
  assert.match(markup, /animate-pulse/);
  assert.match(markup, /aria-busy="true"/);
});
