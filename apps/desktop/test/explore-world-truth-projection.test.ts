import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const explorePanelSource = readSource('../src/shell/renderer/features/explore/explore-panel.tsx');
const exploreViewSource = readSource('../src/shell/renderer/features/explore/explore-view.tsx');
const exploreCardsSource = readSource('../src/shell/renderer/features/explore/explore-cards.tsx');

test('ExplorePanel does not carry a hard-coded featured world catalog', () => {
  assert.doesNotMatch(explorePanelSource, /DEFAULT_FEATURED_WORLDS/);
  assert.doesNotMatch(explorePanelSource, /coding-world/);
  assert.doesNotMatch(explorePanelSource, /creative-world/);
  assert.doesNotMatch(explorePanelSource, /research-world/);
  assert.doesNotMatch(explorePanelSource, /featuredWorlds=/);
});

test('ExploreView renders worlds only through the Atlas catalog surface', () => {
  assert.doesNotMatch(exploreViewSource, /featuredWorlds/);
  assert.doesNotMatch(exploreViewSource, /worldBanners/);
  assert.doesNotMatch(exploreViewSource, /FeaturedWorldHero/);
  assert.doesNotMatch(exploreViewSource, /featuredWorldLive/);
  assert.doesNotMatch(exploreViewSource, /Enter world/);
  assert.doesNotMatch(exploreCardsSource, /FeaturedWorldCard/);
  assert.doesNotMatch(exploreCardsSource, /FeaturedWorldCardData/);
  assert.doesNotMatch(`${explorePanelSource}\n${exploreViewSource}\n${exploreCardsSource}`, /world-tour|World Tour/i);
  assert.match(exploreViewSource, /<WorldCatalogContent/);
  assert.match(exploreViewSource, /worlds=\{props\.worldCatalogItems\}/);
  assert.match(exploreViewSource, /searchQuery=\{props\.worldSearchText\}/);
  assert.match(exploreViewSource, /onSearchQueryChange=\{props\.onWorldSearchTextChange\}/);
});

test('ExplorePanel passes topbar search state into the Worlds Atlas', () => {
  assert.match(explorePanelSource, /worldSearchText=\{props\.searchText\}/);
  assert.match(explorePanelSource, /onWorldSearchTextChange=\{props\.onSearchTextChange\}/);
});
