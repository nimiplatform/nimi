import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readWorldSource(fileName: string): string {
  return readFileSync(
    resolve(import.meta.dirname, `../src/shell/renderer/features/world/${fileName}`),
    'utf8',
  );
}

const worldListSource = [
  'world-list.tsx',
  'world-list-catalog-controls.tsx',
  'world-list-featured-strip.tsx',
  'world-list-compact-card.tsx',
  'world-list-selected-panel.tsx',
].map(readWorldSource).join('\n');

const worldDetailTemplateSource = [
  'world-detail-template.tsx',
  'world-detail-glass-sections.tsx',
  'world-detail-glass-primitives.tsx',
  'world-detail-template-model.ts',
].map(readWorldSource).join('\n');
const worldFeatureSources = {
  'world-list.tsx': worldListSource,
  'world-detail-template.tsx': worldDetailTemplateSource,
};
const explorePanelSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/explore/explore-panel.tsx'),
  'utf8',
);
const exploreViewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/explore/explore-view.tsx'),
  'utf8',
);

test('world atlas page exposes the glass atlas product surface', () => {
  assert.match(worldListSource, /data-testid="world-atlas-glass-layout"/);
  assert.match(worldListSource, /data-testid="world-atlas-category-tabs"/);
  assert.match(worldListSource, /data-testid="world-atlas-featured-strip"/);
  assert.match(worldListSource, /data-testid="world-atlas-world-grid"/);
  assert.match(worldListSource, /data-testid="world-atlas-selected-panel"/);
  assert.match(worldListSource, /searchQuery\?: string/);
  assert.match(worldListSource, /onSearchQueryChange\?: \(value: string\) => void/);
  assert.match(worldListSource, /World\.atlas\.sourceDiscovery/);
  assert.doesNotMatch(worldListSource, /WorldCatalogSidebar/);
});

test('world atlas uses the shell header search as its controlled query source', () => {
  assert.match(explorePanelSource, /onSearchTextChange: \(value: string\) => void/);
  assert.match(exploreViewSource, /worldSearchText: string/);
  assert.match(exploreViewSource, /searchQuery=\{props\.worldSearchText\}/);
  assert.match(exploreViewSource, /onSearchQueryChange=\{props\.onWorldSearchTextChange\}/);
});

test('world detail page exposes setting-first glass detail surface without transit semantics', () => {
  assert.match(worldDetailTemplateSource, /data-testid="world-detail-glass-layout"/);
  assert.match(worldDetailTemplateSource, /data-testid="world-detail-source-discovery"/);
  assert.match(worldDetailTemplateSource, /world-detail-lore-panel/);
  assert.match(worldDetailTemplateSource, /world-detail-character-gallery/);
  assert.match(worldDetailTemplateSource, /world-detail-timeline-panel/);
  assert.match(worldDetailTemplateSource, /WorldDetail\.glass\.sourceDiscovery/);
  assert.match(worldDetailTemplateSource, /onConnectSource/);
  assert.doesNotMatch(worldDetailTemplateSource, /WorldDashboardSection/);
  assert.doesNotMatch(worldDetailTemplateSource, /Transit/);
  assert.doesNotMatch(worldDetailTemplateSource, /Enter World/);
  assert.doesNotMatch(worldDetailTemplateSource, /Active Now/);
  assert.doesNotMatch(worldDetailTemplateSource, /Live/);
});

test('world atlas product surface fails closed instead of using local fallback art', () => {
  for (const [fileName, source] of Object.entries(worldFeatureSources)) {
    assert.doesNotMatch(source, /world-visual-assets/, fileName);
    assert.doesNotMatch(source, /\/assets\/world-atlas/, fileName);
    assert.doesNotMatch(source, /WORLD_HIGHLIGHT_IMAGES/, fileName);
    assert.doesNotMatch(source, /WORLD_REFERENCE_AVATAR/, fileName);
    assert.doesNotMatch(source, /resolveWorldBanner/, fileName);
  }
});
