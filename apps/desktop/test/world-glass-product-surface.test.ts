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

function readOptionalWorldSource(fileName: string): string {
  try {
    return readWorldSource(fileName);
  } catch {
    return '';
  }
}

const worldListSource = [
  'world-list.tsx',
  'world-list-catalog-controls.tsx',
  'world-list-featured-strip.tsx',
  'world-list-compact-card.tsx',
  'world-list-selected-panel.tsx',
].map(readWorldSource).join('\n') + '\n' + readOptionalWorldSource('world-list-cover.tsx');

const selectedPanelSource = readWorldSource('world-list-selected-panel.tsx');
const compactCardSource = readWorldSource('world-list-compact-card.tsx');
const worldExplorerThemeSource = readOptionalWorldSource('world-list-theme.ts');
const worldCoverSource = readOptionalWorldSource('world-list-cover.tsx');

const worldDetailTemplateSource = [
  'world-detail-template.tsx',
  'world-detail-glass-sections.tsx',
  'world-detail-glass-primitives.tsx',
  'world-detail-paper-sections.tsx',
  'world-detail-paper-primitives.tsx',
  'world-detail-paper-model.ts',
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

test('world atlas page exposes the World Explorer product surface', () => {
  assert.match(worldListSource, /data-testid="world-atlas-glass-layout"/);
  assert.match(worldListSource, /data-testid="world-atlas-category-tabs"/);
  assert.match(worldListSource, /data-testid="world-atlas-featured-strip"/);
  assert.doesNotMatch(worldListSource, /data-testid="world-atlas-featured-card-action"/);
  assert.match(worldListSource, /data-testid="world-atlas-world-grid"/);
  assert.match(worldListSource, /data-testid="world-atlas-selected-panel"/);
  assert.match(worldListSource, /searchQuery\?: string/);
  assert.doesNotMatch(worldListSource, /onSearchQueryChange/);
  assert.match(worldListSource, /<AtlasCategoryTabs[\s\S]*view=\{view\}[\s\S]*sort=\{sort\}/);
  assert.doesNotMatch(worldListSource, /WorldCatalogSidebar/);
});

test('world atlas declares one restrained World Explorer theme instead of inline color drift', () => {
  assert.match(worldExplorerThemeSource, /WORLD_EXPLORER_COLORS/);
  assert.match(worldExplorerThemeSource, /background:\s*'#F6F8FB'/);
  assert.match(worldExplorerThemeSource, /surface:\s*'#FFFFFF'/);
  assert.match(worldExplorerThemeSource, /weakSurface:\s*'#F8FAFC'/);
  assert.match(worldExplorerThemeSource, /brand:\s*'#24C6A4'/);
  assert.match(worldExplorerThemeSource, /brandSoft:\s*'#EAFBF6'/);
  assert.match(worldExplorerThemeSource, /text:\s*'#17202A'/);
  assert.match(worldExplorerThemeSource, /textSecondary:\s*'#6B7280'/);
  assert.match(worldExplorerThemeSource, /textMuted:\s*'#9AA4B2'/);
  assert.match(worldExplorerThemeSource, /border:\s*'#E5EAF0'/);
  assert.match(worldExplorerThemeSource, /favorite:\s*'#E95C5C'/);
  assert.match(worldExplorerThemeSource, /WORLD_EXPLORER_SHADOWS/);
});

test('world atlas removes glass-heavy, blue-gradient, and pink favorite styling from the explorer surface', () => {
  assert.doesNotMatch(worldListSource, /material="glass-/);
  assert.doesNotMatch(worldListSource, /var\(--nimi-status-info\)/);
  assert.doesNotMatch(worldListSource, /bg-\[linear-gradient\(135deg,var\(--nimi-status-info\),var\(--nimi-action-primary-bg\)\)\]/);
  assert.doesNotMatch(worldListSource, /status-danger-soft-bg/);
  assert.match(worldListSource, /WORLD_EXPLORER_THEME/);
  assert.match(worldListSource, /world-card--selected/);
  assert.match(worldListSource, /world-panel-primary-action/);
});

test('world atlas selected panel is a user-facing preview without quick entries', () => {
  assert.match(selectedPanelSource, /data-testid="world-atlas-hero-title"/);
  assert.match(selectedPanelSource, /data-testid="world-atlas-preview-intro"/);
  assert.match(selectedPanelSource, /data-testid="world-atlas-preview-overview"/);
  assert.match(selectedPanelSource, /data-testid="world-atlas-preview-people"/);
  assert.doesNotMatch(selectedPanelSource, /data-testid="world-atlas-preview-quick-entries"/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.preview\.quick/);
  assert.match(selectedPanelSource, /World\.atlas\.preview\.metrics/);
  assert.match(selectedPanelSource, /World\.atlas\.preview\.people\.addFriend/);
  assert.match(selectedPanelSource, /World\.atlas\.preview\.people\.unavailable/);
  assert.match(selectedPanelSource, /World\.card\.view/);
  assert.match(selectedPanelSource, /const \{ t, i18n \} = useTranslation\(\)/);
  assert.match(selectedPanelSource, /displayTags\(world, 2, i18n\.language\)/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.sourceCount/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.preview\.chatableTag/);
});

test('world atlas selected panel loads recommended people through the primary display-detail query', () => {
  assert.match(selectedPanelSource, /fetchWorldPrimaryDisplayDetail/);
  assert.match(selectedPanelSource, /worldPrimaryDisplayDetailQueryKey/);
  assert.match(selectedPanelSource, /peopleQuery\.data\?\.characters/);
  assert.doesNotMatch(selectedPanelSource, /fetchWorldDisplayDetail/);
  assert.doesNotMatch(selectedPanelSource, /worldDisplayDetailQueryKey/);
  assert.doesNotMatch(selectedPanelSource, /fetchWorldDetailWithCharacters/);
  assert.doesNotMatch(selectedPanelSource, /worldPreviewPeopleQueryKey/);
});

test('world atlas selected panel drops the schema tabs and backend vocabulary', () => {
  assert.doesNotMatch(selectedPanelSource, /data-testid="world-atlas-schema-tabs"/);
  assert.doesNotMatch(selectedPanelSource, /data-testid="world-atlas-relationship-graph/);
  assert.doesNotMatch(selectedPanelSource, /data-testid="world-atlas-source-discovery-compact"/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.sourceDiscovery/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.entityKinds/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.relationshipGraph/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.recentHighlights/);
});

test('world atlas uses the shell header search as its controlled query source', () => {
  assert.doesNotMatch(explorePanelSource, /onSearchTextChange: \(value: string\) => void/);
  assert.match(exploreViewSource, /worldSearchText: string/);
  assert.match(exploreViewSource, /searchQuery=\{props\.worldSearchText\}/);
  assert.doesNotMatch(exploreViewSource, /onSearchQueryChange/);
});

test('world atlas default-width layout reserves room for browsing before preview density', () => {
  assert.match(worldListSource, /gridTemplateColumns: 'minmax\(760px,1fr\) minmax\(288px,clamp\(288px,24vw,320px\)\)'/);
  assert.match(worldListSource, /gap: 18/);
  assert.match(worldListSource, /repeat\(auto-fill, minmax\(250px, 1fr\)\)/);
  assert.doesNotMatch(worldListSource, /gridTemplateColumns: '112px minmax\(0, 1fr\)'/);
  assert.match(worldListSource, /gridTemplateColumns: 'repeat\(3, minmax\(0, 1fr\)\)'/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.featured\.title/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.featured\.body/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.featured\.viewAll/);
});

test('world atlas uses restrained library elevation instead of the old glass surface shadows', () => {
  assert.match(worldListSource, /WORLD_EXPLORER_SHADOWS\.card/);
  assert.match(worldListSource, /WORLD_EXPLORER_SHADOWS\.selected/);
  assert.doesNotMatch(worldListSource, /0 16px 42px rgba\(54,80,125,0\.08\)/);
  assert.doesNotMatch(worldListSource, /0 18px 34px rgba\(39,55,94,0\.14\)/);
  assert.doesNotMatch(worldListSource, /0 10px 22px rgba\(54,80,125,0\.08\)/);
});

test('world atlas uses complete abstract covers instead of visible initial placeholders', () => {
  assert.match(worldCoverSource, /export function WorldCover/);
  assert.match(worldCoverSource, /data-world-cover-tone/);
  assert.match(worldCoverSource, /worldAbstractCoverBackground/);
  assert.doesNotMatch(compactCardSource, /fallback=\{worldInitial\(world\.name\)\}/);
  assert.doesNotMatch(selectedPanelSource, /text-\[76px\][\s\S]*worldInitial\(world\.name\)/);
});

test('world atlas featured covers fill the card without position-class conflicts', () => {
  assert.match(worldCoverSource, /featured:\s*'absolute inset-0 block overflow-hidden rounded-\[16px\]'/);
  assert.doesNotMatch(worldCoverSource, /relative block shrink-0 overflow-hidden \$\{variantClassName\[variant\]\}/);
});

test('world atlas hard-cuts local chrome primitives in favor of Nimi Kit', () => {
  assert.match(worldListSource, /from '@nimiplatform\/kit\/ui'/);
  for (const primitive of [
    'Surface',
    'Button',
    'IconButton',
    'SegmentedControl',
    'SelectField',
    'Avatar',
    'StatusBadge',
    'Statistic',
    'StatisticGroup',
    'DataList',
    'EmptyState',
    'LoadingSkeleton',
    'NimiText',
  ]) {
    assert.match(worldListSource, new RegExp(`\\b${primitive}\\b`), primitive);
  }
  assert.doesNotMatch(worldListSource, /world-list-catalog-primitives/);
  assert.doesNotMatch(worldListSource, /GLASS_CARD_(?:CLASS|STYLE)/);
  assert.doesNotMatch(worldListSource, /<select\b/);
  assert.doesNotMatch(worldListSource, /role="button"/);
  assert.doesNotMatch(worldListSource, /const TONE_COLORS/);
  assert.doesNotMatch(worldListSource, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(worldListSource, /rgba\(/);
});

test('world atlas scrolling is owned by the app scroll area and has no floating back-to-top affordance', () => {
  assert.match(exploreViewSource, /props\.activeSection === 'worlds'\s*\?\s*'flex min-h-0 flex-1 flex-col'/);
  assert.match(exploreViewSource, /props\.activeSection === 'worlds'\s*\?\s*'w-full px-5 py-5'/);
  assert.doesNotMatch(exploreViewSource, /Explore\.backToTop/);
  assert.doesNotMatch(exploreViewSource, /scrollToTop/);
});

test('world detail page exposes paper detail surface without the duplicate settings block or transit semantics', () => {
  assert.match(worldDetailTemplateSource, /data-testid="world-detail-paper-layout"/);
  assert.doesNotMatch(worldDetailTemplateSource, /data-testid="world-detail-paper-rail"/);
  assert.match(worldDetailTemplateSource, /world-detail-paper-characters/);
  assert.match(worldDetailTemplateSource, /world-detail-paper-timeline/);
  assert.doesNotMatch(worldDetailTemplateSource, /world-detail-paper-settings/);
  assert.match(worldDetailTemplateSource, /WorldDetail\.paper\.rail/);
  assert.match(worldDetailTemplateSource, /onMaterializeSource/);
  assert.doesNotMatch(worldDetailTemplateSource, /WorldDashboardSection/);
  assert.doesNotMatch(worldDetailTemplateSource, /Transit/);
  assert.doesNotMatch(worldDetailTemplateSource, /Enter World/);
  assert.doesNotMatch(worldDetailTemplateSource, /Active Now/);
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
