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
const featuredStripSource = readWorldSource('world-list-featured-strip.tsx');
const worldListControlsSource = readWorldSource('world-list-catalog-controls.tsx');
const worldExplorerThemeSource = readOptionalWorldSource('world-list-theme.ts');
const worldCoverSource = readOptionalWorldSource('world-list-cover.tsx');
const discoveryPanelThemeStart = worldExplorerThemeSource.indexOf('discoveryPanel: {');
const discoveryPanelThemeEnd = worldExplorerThemeSource.indexOf('nav: {', discoveryPanelThemeStart);
const discoveryPanelThemeSource = discoveryPanelThemeStart >= 0 && discoveryPanelThemeEnd > discoveryPanelThemeStart
  ? worldExplorerThemeSource.slice(discoveryPanelThemeStart, discoveryPanelThemeEnd)
  : '';

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
const worldLocaleZhSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/locales/zh/15-World.json'),
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

test('world atlas follows the reference discovery glass composition', () => {
  assert.match(worldListSource, /data-testid="world-atlas-discovery-panel"/);
  assert.match(worldListSource, /World\.atlas\.discovery\.title/);
  assert.match(worldListSource, /World\.atlas\.discovery\.subtitle/);
  assert.match(worldListSource, /data-testid="world-atlas-discover-more"/);
  assert.match(worldListSource, /World\.atlas\.discoverMore/);
  assert.match(worldListSource, /'--world-atlas-shell-columns': 'minmax\(0,1fr\) minmax\(324px,clamp\(324px,24vw,360px\)\)'/);
  assert.match(worldListSource, /min-\[1180px\]:\[grid-template-columns:var\(--world-atlas-shell-columns\)\]/);
  assert.match(worldListSource, /<\/Surface>\s*\{selectedWorld \? \(\s*<SelectedWorldPanel/);
  assert.match(selectedPanelSource, /className="w-full min-w-0 max-w-full overflow-hidden rounded-\[32px\] min-\[1180px\]:sticky min-\[1180px\]:top-3"/);
  assert.match(worldListSource, /panel:\s*'relative block h-\[232px\] shrink-0 overflow-hidden rounded-\[24px\]'/);
  assert.match(worldListSource, /'relative min-h-\[182px\] min-w-0 max-w-full overflow-hidden rounded-\[18px\]/);
  assert.match(worldListSource, /'relative min-h-\[112px\] min-w-0 max-w-full rounded-\[20px\]/);
});

test('world atlas declares one restrained World Explorer theme instead of inline color drift', () => {
  assert.match(worldExplorerThemeSource, /WORLD_EXPLORER_COLORS/);
  assert.match(worldExplorerThemeSource, /background:\s*'#F6F8FB'/);
  assert.match(worldExplorerThemeSource, /surface:\s*'#FFFFFF'/);
  assert.match(worldExplorerThemeSource, /weakSurface:\s*'#F8FAFC'/);
  assert.match(worldExplorerThemeSource, /brand:\s*'#4ECCA3'/);
  assert.match(worldExplorerThemeSource, /brandHover:\s*'#3DBB96'/);
  assert.match(worldExplorerThemeSource, /brandSoft:\s*'rgba\(78, 204, 163, 0\.12\)'/);
  assert.doesNotMatch(worldExplorerThemeSource, /#24C6A4|#1DB393|rgba\(36, 198, 164/);
  assert.match(worldExplorerThemeSource, /text:\s*'#17202A'/);
  assert.match(worldExplorerThemeSource, /textSecondary:\s*'#6B7280'/);
  assert.match(worldExplorerThemeSource, /textMuted:\s*'#9AA4B2'/);
  assert.match(worldExplorerThemeSource, /border:\s*'#E5EAF0'/);
  assert.match(worldExplorerThemeSource, /favorite:\s*'#E95C5C'/);
  assert.match(worldExplorerThemeSource, /WORLD_EXPLORER_SHADOWS/);
});

test('world atlas confines glass to the reference shell without blue-gradient or pink favorite styling', () => {
  assert.match(worldListSource, /data-testid="world-atlas-discovery-panel"[\s\S]*tone="panel"[\s\S]*material="glass-regular"/);
  assert.doesNotMatch(discoveryPanelThemeSource, /background:/);
  assert.doesNotMatch(discoveryPanelThemeSource, /border:/);
  assert.doesNotMatch(worldListSource, /data-testid="world-atlas-featured-card"[\s\S]*material="glass-/);
  assert.doesNotMatch(worldListSource, /data-testid="world-atlas-selected-panel"[\s\S]*material="glass-/);
  assert.doesNotMatch(worldListSource, /var\(--nimi-status-info\)/);
  assert.doesNotMatch(worldListSource, /bg-\[linear-gradient\(135deg,var\(--nimi-status-info\),var\(--nimi-action-primary-bg\)\)\]/);
  assert.doesNotMatch(worldListSource, /status-danger-soft-bg/);
  assert.match(worldListSource, /WORLD_EXPLORER_THEME/);
  assert.match(worldListSource, /world-card--selected/);
  assert.match(worldListSource, /world-panel-primary-action/);
});

test('world atlas selected panel is a user-facing preview without quick entries', () => {
  assert.match(selectedPanelSource, /data-testid="world-atlas-hero-title"/);
  assert.match(selectedPanelSource, /data-testid="world-atlas-hero-title"[\s\S]*className="w-full truncate text-center/);
  assert.match(selectedPanelSource, /data-testid="world-atlas-preview-intro"/);
  assert.match(selectedPanelSource, /data-testid="world-atlas-preview-overview"/);
  assert.match(selectedPanelSource, /data-testid="world-atlas-preview-people"/);
  assert.doesNotMatch(selectedPanelSource, /data-testid="world-atlas-preview-quick-entries"/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.preview\.quick/);
  assert.match(selectedPanelSource, /World\.atlas\.preview\.metrics/);
  assert.match(selectedPanelSource, /World\.atlas\.preview\.people\.joinLocalAgent/);
  assert.match(worldLocaleZhSource, /"joinLocalAgent": "添加角色"/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.preview\.people\.addFriend/);
  assert.match(selectedPanelSource, /World\.atlas\.preview\.people\.unavailable/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.preview\.people\.viewAll/);
  assert.doesNotMatch(selectedPanelSource, /action=\{t\('World\.atlas\.preview\.people\.viewAll'\)\}/);
  assert.match(selectedPanelSource, /World\.card\.view/);
  assert.match(selectedPanelSource, /world-panel-primary-action[\s\S]*text-\[var\(--nimi-action-primary-text\)\]/);
  assert.doesNotMatch(selectedPanelSource, /style=\{WORLD_EXPLORER_THEME\.introClamp\}/);
  assert.doesNotMatch(worldExplorerThemeSource, /introClamp|WebkitLineClamp/);
  assert.match(selectedPanelSource, /const \{ t, i18n \} = useTranslation\(\)/);
  assert.match(selectedPanelSource, /displayTags\(world, 2, i18n\.language\)/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.sourceCount/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.preview\.chatableTag/);
});

test('world atlas selected panel places metrics between title and description', () => {
  const titleIndex = selectedPanelSource.indexOf('data-testid="world-atlas-hero-title"');
  const metricsIndex = selectedPanelSource.indexOf('data-testid="world-atlas-preview-overview"');
  const introIndex = selectedPanelSource.indexOf('data-testid="world-atlas-preview-intro"');
  assert.ok(titleIndex >= 0, 'selected panel title marker must exist');
  assert.ok(metricsIndex >= 0, 'selected panel metrics marker must exist');
  assert.ok(introIndex >= 0, 'selected panel intro marker must exist');
  assert.ok(titleIndex < metricsIndex, 'metrics must render below the selected world title');
  assert.ok(metricsIndex < introIndex, 'description must render below the metrics block');
});

test('world atlas selected panel keeps preview metrics and people action compact', () => {
  assert.doesNotMatch(selectedPanelSource, /\b(?:Archive|Image|Network|Users)\b/);
  assert.match(selectedPanelSource, /function PanelMetric/);
  assert.match(selectedPanelSource, /value=\{formatPanelMetric\(peopleCount\)\}/);
  assert.match(selectedPanelSource, /value=\{formatPanelMetric\(world\.entityCount\)\}/);
  assert.match(selectedPanelSource, /value=\{formatPanelMetric\(world\.sceneCount\)\}/);
  assert.match(selectedPanelSource, /value=\{relationships > 0 \? formatPanelMetric\(relationships\) : '0'\}/);
  assert.match(selectedPanelSource, /Math\.round\(n \/ 1000\)/);
  assert.doesNotMatch(selectedPanelSource, /<Statistic\b/);
  assert.doesNotMatch(selectedPanelSource, /label=\{t\('World\.atlas\.preview\.metrics/);
  assert.doesNotMatch(selectedPanelSource, /className="mt-4 grid-cols-4 gap-1 rounded-\[16px\] border/);
  assert.doesNotMatch(selectedPanelSource, /nimi-statistic__label/);
});

test('world atlas selected panel moves follow into hero chrome and removes share menu icons', () => {
  assert.doesNotMatch(selectedPanelSource, /\bShare2\b/);
  assert.doesNotMatch(selectedPanelSource, /\bMoreHorizontal\b/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.actions\.shareWorld/);
  assert.doesNotMatch(selectedPanelSource, /World\.atlas\.actions\.moreWorldActions/);
  assert.doesNotMatch(selectedPanelSource, /grid-cols-\[minmax\(0,1fr\)_52px\]/);
  assert.match(selectedPanelSource, /absolute right-3 top-3/);
  assert.match(selectedPanelSource, /data-testid="world-panel-follow-toggle"/);
  assert.match(selectedPanelSource, /icon=\{<Heart size=\{16\}/);
  assert.match(selectedPanelSource, /size="sm"/);
  assert.match(selectedPanelSource, /className=\{followed\s*\?\s*'rounded-full text-\[var\(--world-explorer-favorite\)\]'/);
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
  assert.match(worldListSource, /'--world-atlas-shell-columns': 'minmax\(0,1fr\) minmax\(324px,clamp\(324px,24vw,360px\)\)'/);
  assert.match(worldListSource, /gap-\[18px\] min-\[1180px\]:\[grid-template-columns:var\(--world-atlas-shell-columns\)\]/);
  assert.match(worldListSource, /repeat\(auto-fit, minmax\(min\(100%, 250px\), 1fr\)\)/);
  assert.doesNotMatch(worldListSource, /gridTemplateColumns: '112px minmax\(0, 1fr\)'/);
  assert.match(worldListSource, /min-\[860px\]:\[grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\]/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.featured\.title/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.featured\.body/);
  assert.doesNotMatch(worldListSource, /World\.atlas\.featured\.viewAll/);
});

test('world atlas narrow shell releases width pressure instead of preserving desktop min-content', () => {
  assert.match(exploreViewSource, /props\.activeSection === 'worlds'\s*\?\s*'min-w-0 w-full max-w-full overflow-x-hidden px-3 py-4 sm:px-5 sm:py-5'/);
  assert.match(worldListSource, /className="mx-auto min-w-0 w-full max-w-\[min\(100%,1390px\)\]"/);
  assert.match(worldListSource, /className="min-w-0 max-w-full rounded-\[32px\] p-4 sm:p-5 xl:p-6"/);
  assert.match(worldListSource, /'grid min-w-0 items-start gap-\[18px\]',\s*selectedWorld \? 'min-\[1180px\]:\[grid-template-columns:var\(--world-atlas-shell-columns\)\]' : ''/);
  assert.match(worldListSource, /style=\{selectedWorld \? WORLD_ATLAS_SHELL_COLUMNS_STYLE : undefined\}/);
  assert.match(worldListSource, /<main className="mt-6 grid min-w-0 max-w-full gap-6">/);
  assert.match(worldListControlsSource, /flex min-w-0 flex-col gap-2 min-\[640px\]:flex-row/);
  assert.match(worldListControlsSource, /flex-1 flex-wrap overflow-visible/);
  assert.match(worldListControlsSource, /min-w-0 flex-1 rounded-\[16px\][\s\S]*min-\[640px\]:w-\[124px\][\s\S]*min-\[640px\]:max-w-\[124px\]/);
  assert.match(featuredStripSource, /grid min-w-0 max-w-full grid-cols-1 gap-4 min-\[860px\]:\[grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\]/);
  assert.match(selectedPanelSource, /mt-4 grid-cols-2 gap-1 min-\[460px\]:grid-cols-4/);
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
  assert.match(worldCoverSource, /featured:\s*'absolute inset-0 block overflow-hidden rounded-\[18px\]'/);
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
  assert.match(exploreViewSource, /props\.activeSection === 'worlds'\s*\?\s*'min-w-0 w-full max-w-full overflow-x-hidden px-3 py-4 sm:px-5 sm:py-5'/);
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
