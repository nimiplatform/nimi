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
const packetSource = readSource(
  '../../../.nimi/topics/ongoing/2026-04-24-governance-runtime-desktop-gate-repair/packet-wave-2-desktop-explore-world-truth-projection.md',
);

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
  assert.match(exploreViewSource, /worldsWithBanners = props\.worldBanners\.filter/);
  assert.match(exploreViewSource, /props\.onWorldOpen\?\.\(currentBanner\.id\)/);
});

test('packet claims only finding-0016 for the world projection repair', () => {
  assert.match(packetSource, /finding_claims:\n  - finding-0016/);
  assert.doesNotMatch(packetSource, /finding_claims:[\s\S]*finding-0010/);
  assert.doesNotMatch(packetSource, /finding_claims:[\s\S]*finding-0013/);
  assert.doesNotMatch(packetSource, /finding_claims:[\s\S]*finding-0023/);
});
