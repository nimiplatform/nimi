import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Kit primitives expect React on the global object in the server-render test path.
(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { ExploreSourceModeFlap } from '../src/shell/renderer/features/explore/explore-source-mode-flap';
import { PersonaCatalogContent, PersonaCatalogMore } from '../src/shell/renderer/features/explore/persona-catalog-content';

test.before(async () => {
  await initI18n();
  await changeLocale('zh');
});

test('Explore source mode exposes exactly Worlds and Personas with Personas selected', () => {
  const markup = renderToStaticMarkup(
    <ExploreSourceModeFlap mode="personas" onChange={() => {}} />,
  );

  assert.match(markup, /data-testid="explore-source-mode-worlds"/);
  assert.match(markup, /data-testid="explore-source-mode-personas"/);
  const personasButton = markup.match(/<button[^>]*data-testid="explore-source-mode-personas"[^>]*>/)?.[0] ?? '';
  assert.match(personasButton, /aria-pressed="true"/);
  assert.equal((markup.match(/data-testid="explore-source-mode-(?:worlds|personas)"/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /agents/i);
});

test('Explore Personas renders the empty catalog without a separate Characters surface', () => {
  const markup = renderToStaticMarkup(
    <PersonaCatalogContent personas={[]} embedded />,
  );

  assert.match(markup, /data-testid="persona-rail"/);
  assert.match(markup, />Persona</);
  assert.match(markup, /当前筛选条件下没有 Persona/);
  assert.doesNotMatch(markup, /My Characters|我的角色|agents-panel/i);
});

test('Persona catalog distinguishes an offline first read from an empty result', () => {
  const markup = renderToStaticMarkup(<PersonaCatalogContent personas={[]} error offline embedded />);
  assert.match(markup, /离线时暂时无法搜索 Persona/);
  assert.doesNotMatch(markup, /当前筛选条件下没有 Persona/);
});

test('Persona rail and grid share paging that preserves a later-page failure and stops offline loading', () => {
  const props = { hasMore: true, loadingMore: false, loadMoreFailed: true, onLoadMore: () => {} };
  const failed = renderToStaticMarkup(<PersonaCatalogMore {...props} offline={false} />);
  assert.match(failed, /已加载的结果仍可查看/);
  assert.match(failed, /重试/);
  const offline = renderToStaticMarkup(<PersonaCatalogMore {...props} offline />);
  assert.match(offline, /只显示已经加载的 Persona/);
  assert.doesNotMatch(offline, /<button/);
});
