import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExploreSectionNav } from '../src/shell/renderer/features/explore/explore-section-nav.js';
import { changeLocale, initI18n } from '../src/shell/renderer/i18n/index.js';
(globalThis as { React?: typeof React }).React = React;

test('Explore keeps World discovery without duplicating My partners', async () => {
  await initI18n(); await changeLocale('zh');
  const html = renderToStaticMarkup(<ExploreSectionNav active="worlds" onSelect={() => {}} />);
  assert.match(html, /explore-section-tab-worlds/);
  assert.doesNotMatch(html, /explore-section-tab-partners/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /explore-section-tab-personas|Persona/);
});
