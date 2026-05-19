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

test('ExploreView takes featured world data only from World truth banners', () => {
  assert.doesNotMatch(exploreViewSource, /featuredWorlds/);
  assert.doesNotMatch(exploreCardsSource, /FeaturedWorldCard/);
  assert.doesNotMatch(exploreCardsSource, /FeaturedWorldCardData/);
  assert.doesNotMatch(`${explorePanelSource}\n${exploreViewSource}\n${exploreCardsSource}`, /world-tour|World Tour|tester/i);
  assert.match(exploreViewSource, /worldsWithBanners = props\.worldBanners\.filter/);
  assert.match(exploreViewSource, /props\.onWorldOpen\?\.\(currentBanner\.id\)/);
});
