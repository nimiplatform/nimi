import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Kit primitives expect React on the global object in the server-render test path.
(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { ExploreSourceModeFlap } from '../src/shell/renderer/features/explore/explore-source-mode-flap';
import { PersonaCatalogContent } from '../src/shell/renderer/features/explore/persona-catalog-content';

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
