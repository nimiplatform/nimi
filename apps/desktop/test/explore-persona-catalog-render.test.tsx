import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExploreSectionNav } from '../src/shell/renderer/features/explore/explore-section-nav.js';
import { changeLocale, initI18n } from '../src/shell/renderer/i18n/index.js';
(globalThis as { React?: typeof React }).React = React;

test('Explore exposes Worlds and actual My partners as its only primary sections', async () => {
  await initI18n(); await changeLocale('zh');
  const html = renderToStaticMarkup(<ExploreSectionNav active="partners" onSelect={() => {}} />);
  assert.match(html, /我的伙伴/);
  assert.match(html, /explore-section-tab-worlds/);
  assert.match(html, /explore-section-tab-partners/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /explore-section-tab-personas|Persona/);
});
