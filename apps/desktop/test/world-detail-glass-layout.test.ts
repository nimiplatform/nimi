import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

// scenario_id: world.surface-layout
function readWorldSource(fileName: string): string {
  return readFileSync(
    resolve(import.meta.dirname, `../src/shell/renderer/features/world/${fileName}`),
    'utf8',
  );
}

const worldTemplateSource = [
  'world-detail-template.tsx',
  'world-detail-glass-sections.tsx',
  'world-detail-glass-primitives.tsx',
  'world-detail-paper-sections.tsx',
  'world-detail-paper-primitives.tsx',
  'world-detail-paper-model.ts',
  'world-detail-template-model.ts',
].map(readWorldSource).join('\n');
const paperPrimitiveSource = readWorldSource('world-detail-paper-primitives.tsx');
const paperSectionsSource = readWorldSource('world-detail-paper-sections.tsx');
const glassSectionsSource = readWorldSource('world-detail-glass-sections.tsx');
const relationshipExplorerSource = readWorldSource('world-detail-relationship-explorer.tsx');
const relationshipExplorerLocaleSource = ['zh', 'en'].map((locale) => {
  const localeJson = JSON.parse(readFileSync(
    resolve(import.meta.dirname, `../src/shell/renderer/locales/${locale}/41-WorldDetail.json`),
    'utf8',
  ));
  return JSON.stringify(localeJson.paper.relationshipExplorer);
}).join('\n');
const desktopFeatureCoverageSource = readFileSync(
  resolve(import.meta.dirname, '../../../.nimi/spec/desktop/kernel/tables/desktop-feature-coverage.yaml'),
  'utf8',
);

test('world surface feature coverage points at the active glass layout contract', () => {
  assert.match(desktopFeatureCoverageSource, /scenario_id: world\.surface-layout/);
  assert.match(desktopFeatureCoverageSource, /spec_path: apps\/desktop\/test\/world-detail-glass-layout\.test\.ts/);
  assert.doesNotMatch(desktopFeatureCoverageSource, /world-detail-bento-layout\.test\.ts/);
});

test('world detail hard-cuts to the paper setting discovery surface', () => {
  assert.match(worldTemplateSource, /data-testid="world-detail-paper-layout"/);
  assert.match(worldTemplateSource, /function DetailHero/);
  assert.match(worldTemplateSource, /function PaperMetricStrip/);
  // World detail is a single left column — no right rail.
  assert.doesNotMatch(worldTemplateSource, /function PaperRightRail/);
  assert.doesNotMatch(worldTemplateSource, /data-testid="world-detail-paper-rail"/);
  assert.doesNotMatch(worldTemplateSource, /composition\.sections/);
  assert.doesNotMatch(worldTemplateSource, /world-detail-root/);
  assert.doesNotMatch(worldTemplateSource, /world-detail-dashboard/);
  assert.doesNotMatch(worldTemplateSource, /WorldDashboardSection/);
});

test('world detail product semantics stay record-first and source-first', () => {
  assert.match(worldTemplateSource, /WorldDetail\.paper\.paths\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.paper\.characters\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.paper\.materials\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.paper\.timeline\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.paper\.scenes\.title/);
  // World follow stays in the hero; low-value banner chips are omitted.
  assert.match(worldTemplateSource, /data-testid="world-detail-hero-world-follow"/);
  assert.match(worldTemplateSource, /onMaterializeSource/);
  assert.doesNotMatch(worldTemplateSource, /PaperRightRail/);
  assert.doesNotMatch(worldTemplateSource, /data-testid="world-detail-paper-rail"/);
  assert.doesNotMatch(worldTemplateSource, /Transit/);
  assert.doesNotMatch(worldTemplateSource, /Enter World/);
  assert.doesNotMatch(worldTemplateSource, /Active Now/);
  assert.doesNotMatch(worldTemplateSource, /accepting arrivals/);
});

test('world detail paper and hero surfaces consume Nimi kit primitives', () => {
  assert.match(paperPrimitiveSource, /from '@nimiplatform\/kit\/ui'/);
  assert.match(paperPrimitiveSource, /<Surface\s+as="section"/);
  assert.match(paperPrimitiveSource, /<Avatar/);
  assert.match(paperPrimitiveSource, /<StatusBadge/);
  assert.match(paperPrimitiveSource, /<Button[\s\S]*trailingIcon=\{<IconChevron/);
  assert.match(paperPrimitiveSource, /<IconButton/);
  assert.doesNotMatch(paperPrimitiveSource, /function strokeIcon/);

  assert.match(paperSectionsSource, /from '@nimiplatform\/kit\/ui'/);
  assert.match(paperSectionsSource, /<Statistic/);
  assert.match(paperSectionsSource, /<Surface\s+as="button"/);
  assert.match(paperSectionsSource, /<Button/);

  assert.match(glassSectionsSource, /from '@nimiplatform\/kit\/ui'/);
  assert.match(glassSectionsSource, /<Surface\s+as="section"/);
  assert.match(glassSectionsSource, /<IconButton/);
  assert.match(glassSectionsSource, /<Button/);
  assert.match(glassSectionsSource, /<NimiText/);
  assert.doesNotMatch(glassSectionsSource, /function IconFollow/);
});

test('world detail hero does not render banner tags', () => {
  assert.doesNotMatch(worldTemplateSource, /data-testid="world-detail-hero-tags"/);
  assert.doesNotMatch(worldTemplateSource, /const tags = displayTags\(world\)/);
  assert.doesNotMatch(worldTemplateSource, /<Pill key=\{tag\}/);
  assert.doesNotMatch(worldTemplateSource, /onMedia:/);
});

test('world detail keeps character source quick sheets but opens scenes as an in-page drill-down', () => {
  assert.match(worldTemplateSource, /WorldCharacterQuickSheet/);
  assert.match(worldTemplateSource, /WorldSceneDetailPage/);
  assert.match(worldTemplateSource, /setActivePaperSubpage\('scene-detail'\)/);
  assert.doesNotMatch(worldTemplateSource, /WorldSceneQuickSheet/);
  assert.match(worldTemplateSource, /onMaterializeSource/);
  assert.match(worldTemplateSource, /onViewCharacter/);
  assert.match(worldTemplateSource, /Chat is materialized only after Runtime creates a device-local LocalAgent\./);
});

test('world detail opens the people archive as an in-page drill-down, not a modal', () => {
  assert.match(worldTemplateSource, /WorldPeopleArchivePage/);
  assert.match(worldTemplateSource, /activePaperSubpage/);
  assert.match(worldTemplateSource, /setActivePaperSubpage\('people-archive'\)/);
  assert.doesNotMatch(worldTemplateSource, /setPeopleGalleryOpen\(true\)/);
});

test('world detail scrolls the in-page drill-down into view after opening it', () => {
  assert.match(worldTemplateSource, /activePaperSubpage !== 'root'/);
  assert.match(worldTemplateSource, /scrollIntoView\(\{ behavior: 'auto', block: 'start' \}\)/);
});

test('world detail resolves the people material card to the people archive page', async () => {
  const mod = await import('../src/shell/renderer/features/world/world-detail-template.js');
  assert.equal(mod.resolveWorldMaterialSubpage('people'), 'people-archive');
  assert.equal(mod.resolveWorldMaterialSubpage('scenes'), null);
  assert.equal(mod.resolveWorldMaterialSubpage('events'), null);
  assert.equal(mod.resolveWorldMaterialSubpage('resources'), null);
  assert.equal(mod.resolveWorldMaterialSubpage('lore'), null);
});

test('world relationship explorer is a three-column user-facing exploration page', () => {
  // Left people browser, center relationship network, right collapsible detail panel.
  assert.match(relationshipExplorerSource, /function PeoplePanel/);
  assert.match(relationshipExplorerSource, /function RelationshipNetwork/);
  assert.match(relationshipExplorerSource, /function ProfileSummary/);
  assert.match(relationshipExplorerSource, /function RelationshipDetailPanel/);
  // Single-character worlds still resolve to a profile instead of an empty graph.
  assert.match(relationshipExplorerSource, /function ProfileFallback/);
  // People and relation filters are localized through key templates, not hardcoded labels.
  assert.match(relationshipExplorerSource, /relationshipExplorer\.peopleList\.filters\.\$\{key\}/);
  assert.match(relationshipExplorerSource, /relationshipExplorer\.kinds\.\$\{kind\}/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-person-title-row"/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-person-count"/);
  assert.match(relationshipExplorerSource, /padding: '9px 16px 9px 10px'/);
  assert.match(relationshipExplorerSource, /const FILTER_KEYS[^=]*=\s*\['all', 'featured', 'literati', 'academy', 'open'\]/);
  assert.match(relationshipExplorerSource, /const RELATION_FILTER_KEYS[^=]*=\s*\['all', \.\.\.KIND_ORDER\]/);
  assert.match(relationshipExplorerLocaleSource, /元代文人书院世界/);
  assert.match(relationshipExplorerLocaleSource, /关系网络/);
  assert.match(relationshipExplorerLocaleSource, /人物档案/);
  assert.match(relationshipExplorerLocaleSource, /静态历史世界/);
  assert.match(relationshipExplorerLocaleSource, /主要线索/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-topbar"/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-story-panel"/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-graph-toolbar"/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-detail-panel"/);
  assert.match(relationshipExplorerSource, /const GRAPH_DEFAULT_ZOOM = 1\.1/);
  assert.match(relationshipExplorerSource, /minHeight: 720/);
  assert.match(relationshipExplorerSource, /aspectRatio: '1 \/ 1'/);
  assert.match(relationshipExplorerSource, /viewBox="0 0 1000 1000"/);
  assert.match(relationshipExplorerSource, /height: '100%', display: 'block'/);
  assert.match(relationshipExplorerSource, /setZoomScale\(GRAPH_DEFAULT_ZOOM\)/);
  assert.match(relationshipExplorerSource, /gridTemplateColumns: 'minmax\(212px,244px\) minmax\(0,1fr\) minmax\(300px,340px\)'/);
  assert.match(relationshipExplorerSource, /zoomScale/);
  assert.match(relationshipExplorerSource, /zoomIn/);
  assert.match(relationshipExplorerSource, /zoomOut/);
  assert.match(relationshipExplorerSource, /resetView/);
  assert.match(relationshipExplorerSource, /detailCollapsed/);
  assert.match(relationshipExplorerSource, /onToggleDetailPanel/);
  assert.match(relationshipExplorerSource, /PanelRightOpen/);
  assert.match(relationshipExplorerSource, /PanelRightClose/);
  assert.match(relationshipExplorerSource, /const collapsedExplorerColumns = 'minmax\(212px,244px\) minmax\(0,1fr\)'/);
  assert.match(relationshipExplorerSource, /function relationshipGraphEdgeLabelPosition/);
  assert.match(relationshipExplorerSource, /CENTER_GRAPH_CARD_BOUNDS/);
  assert.match(relationshipExplorerSource, /TARGET_GRAPH_CARD_BOUNDS/);
  assert.match(relationshipExplorerSource, /const selectCenter = \(characterId: string\) => \{[\s\S]*?setDetailCollapsed\(false\)/);
  assert.match(relationshipExplorerSource, /const selectEdge = \(edgeId: string\) => \{[\s\S]*?setDetailCollapsed\(false\)/);
  assert.match(relationshipExplorerSource, /const selectClue = \(recordId: string\) => \{[\s\S]*?setDetailCollapsed\(false\)/);
  assert.match(relationshipExplorerSource, /primaryClues = clues\.slice\(0, 3\)/);
  assert.doesNotMatch(relationshipExplorerSource, /\(GRAPH_CENTER\.x \+ position\.x\) \/ 2 - 54/);
  assert.doesNotMatch(relationshipExplorerSource, /\(GRAPH_CENTER\.y \+ position\.y\) \/ 2 - 14/);
  assert.doesNotMatch(relationshipExplorerSource, /Maximize2|Minimize2|isFullscreen|onToggleFullscreen|controls\.fullscreen/);
  assert.doesNotMatch(relationshipExplorerSource, /minmax\(0,1fr\) 48px|placeItems: 'start center'/);
  assert.doesNotMatch(relationshipExplorerSource, /data-testid="world-relationship-hero-copy"/);
  assert.doesNotMatch(relationshipExplorerSource, /source\.tags|sourceTags|待挂接|暂无关系证据|未匹配|数据覆盖|证据覆盖/);
  assert.doesNotMatch(relationshipExplorerLocaleSource, /source\.tags|sourceTags|待挂接|暂无关系证据|未匹配|数据覆盖|证据覆盖/);
  assert.match(relationshipExplorerLocaleSource, /"peopleList":\{[^}]*"clueCount":"\{\{count\}\}"/);
  assert.doesNotMatch(relationshipExplorerLocaleSource, /"peopleList":\{[^}]*"clueCount":"\{\{count\}\} 条"/);
  assert.doesNotMatch(relationshipExplorerSource, /relation\.confidence|relation\.source/);
  assert.doesNotMatch(relationshipExplorerLocaleSource, /可信程度|来源说明|Confidence|Source explanation/);
});
