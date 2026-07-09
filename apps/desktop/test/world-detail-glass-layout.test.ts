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
const worldDetailSource = readWorldSource('world-detail.tsx');
const worldDetailTemplateSource = readWorldSource('world-detail-template.tsx');
const worldDetailLayoutSource = readWorldSource('world-detail-layout.ts');
const paperPrimitiveSource = readWorldSource('world-detail-paper-primitives.tsx');
const paperSectionsSource = readWorldSource('world-detail-paper-sections.tsx');
const glassSectionsSource = readWorldSource('world-detail-glass-sections.tsx');
const peopleGallerySource = readWorldSource('world-detail-people-gallery.tsx');
const relationshipExplorerSource = readWorldSource('world-detail-relationship-explorer.tsx');
const relationshipExplorerModelSource = readWorldSource('world-detail-relationship-explorer-model.ts');
const relationshipNetworkSource = readWorldSource('world-detail-relationship-network.tsx');
const loreLibrarySource = readWorldSource('world-detail-lore-library.tsx');
const resourceReferencesSource = readWorldSource('world-detail-resource-references.tsx');
const sceneDetailSource = readWorldSource('world-detail-scene-detail-page.tsx');
const skeletonSource = readWorldSource('world-detail-skeletons.tsx');
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
const exploreViewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/explore/explore-view.tsx'),
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
  assert.match(worldTemplateSource, /WorldDetail\.paper\.loreOverview\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.paper\.scenes\.title/);
  assert.doesNotMatch(worldTemplateSource, /WorldDetail\.paper\.materials\.title/);
  assert.doesNotMatch(worldDetailTemplateSource, /PaperTimelineSection/);
  assert.doesNotMatch(worldDetailTemplateSource, /world-detail-timeline/);
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

test('world detail paper metric strip does not squeeze labels into the icon column', () => {
  assert.doesNotMatch(paperSectionsSource, /grid-cols-\[46px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(paperSectionsSource, /items-center gap-x-3 border-0 bg-transparent p-\[18px\]/);
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

test('world detail centers the scene exploration section when a scene path is entered', () => {
  assert.match(worldDetailSource, /viewportRef=\{detailViewportRef\}/);
  assert.match(worldDetailSource, /rootScrollViewportRef=\{detailViewportRef\}/);
  assert.match(worldDetailTemplateSource, /WORLD_DETAIL_SCENES_SECTION_ID = 'world-detail-scenes'/);
  assert.match(worldDetailTemplateSource, /worldDetailRootSectionScrollTop/);
  assert.match(worldDetailTemplateSource, /scrollViewport\.scrollTo/);
  assert.match(worldDetailTemplateSource, /onGoScenes:\s*\(\) => scrollToSection\(WORLD_DETAIL_SCENES_SECTION_ID\)/);
});

test('world detail drill-down pages share the root paper top safe area', () => {
  assert.match(worldTemplateSource, /worldDetailPaperContentFrameStyle/);
  assert.match(peopleGallerySource, /worldDetailPaperContentFrameStyle/);
  assert.match(relationshipExplorerSource, /WORLD_DETAIL_PAPER_CONTENT_PADDING/);
  assert.match(loreLibrarySource, /worldDetailPaperContentFrameStyle/);
  assert.match(resourceReferencesSource, /worldDetailPaperContentFrameStyle/);
  assert.match(sceneDetailSource, /worldDetailPaperContentFrameStyle/);
  assert.match(skeletonSource, /WORLD_DETAIL_PAPER_CONTENT_PADDING/);
  assert.match(skeletonSource, /worldDetailPaperContentFrameStyle/);
  assert.doesNotMatch(peopleGallerySource, /padding: '22px 28px 80px'/);
  assert.doesNotMatch(loreLibrarySource, /padding: '22px 28px 80px'/);
  assert.doesNotMatch(resourceReferencesSource, /padding: '22px 28px 80px'/);
  assert.doesNotMatch(sceneDetailSource, /padding: '22px 28px 80px'/);
  assert.doesNotMatch(peopleGallerySource, /calc\(100vh - 154px\)/);
  assert.doesNotMatch(sceneDetailSource, /calc\(100vh-154px\)/);
  assert.doesNotMatch(skeletonSource, /SUBPAGE_CONTENT_PADDING = '22px 28px 80px'/);
  assert.doesNotMatch(relationshipExplorerSource, /EXPLORER_TOP_OFFSET_PX = 154/);
});

test('world detail root content aligns with the atlas top content offset', () => {
  assert.match(exploreViewSource, /props\.activeSection === 'worlds'\s*\?\s*'flex min-h-0 flex-1 flex-col'/);
  assert.match(exploreViewSource, /props\.activeSection === 'worlds'\s*\?\s*'min-w-0 w-full max-w-full overflow-x-hidden px-3 py-4 sm:px-5 sm:py-5'/);
  assert.match(worldDetailLayoutSource, /WORLD_DETAIL_PAPER_TOP_PADDING = '20px'/);
  assert.match(worldDetailLayoutSource, /WORLD_DETAIL_PAPER_CONTENT_PADDING = `\$\{WORLD_DETAIL_PAPER_TOP_PADDING\} 28px 80px`/);
  assert.doesNotMatch(worldDetailLayoutSource, /3\.5rem \+ 1\.75rem \+ 22px|calc\(3\.5rem\+1\.75rem\)/);
});

test('world scene detail page uses page scroll instead of a capped internal viewport', () => {
  assert.doesNotMatch(sceneDetailSource, /max-h-\[720px\]/);
});

test('world detail does not expose the retired material card router', () => {
  assert.doesNotMatch(worldTemplateSource, /resolveWorldMaterialSubpage/);
  assert.doesNotMatch(worldTemplateSource, /PaperMaterialsSection/);
  assert.doesNotMatch(worldTemplateSource, /world-detail-materials/);
});

test('world relationship explorer is a three-column user-facing exploration page', () => {
  // Left people browser, center relationship network, right collapsible detail panel.
  assert.match(relationshipExplorerSource, /function PeoplePanel/);
  assert.match(relationshipNetworkSource, /function RelationshipNetwork/);
  assert.match(relationshipExplorerSource, /function ProfileSummary/);
  assert.match(relationshipExplorerSource, /function RelationshipDetailPanel/);
  // Single-character worlds still resolve to a profile instead of an empty graph.
  assert.match(relationshipExplorerSource, /function ProfileFallback/);
  // People and relation filters are localized through key templates, not hardcoded labels.
  assert.match(relationshipExplorerSource, /relationshipExplorer\.peopleList\.filters\.\$\{key\}/);
  assert.match(relationshipExplorerModelSource, /relationshipExplorer\.kinds\.\$\{kind\}/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-person-title-row"/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-person-count"/);
  assert.match(relationshipExplorerSource, /padding: '9px 10px'/);
  assert.match(relationshipExplorerModelSource, /const FILTER_KEYS[^=]*=\s*\['all', 'literati', 'academy'\]/);
  assert.match(relationshipExplorerModelSource, /const RELATION_FILTER_KEYS[^=]*=\s*\['all', \.\.\.KIND_ORDER\]/);
  // The topbar title binds the live world name; locale copy must not hardcode a world name.
  assert.match(relationshipExplorerSource, /\{world\.name\}/);
  assert.doesNotMatch(relationshipExplorerLocaleSource, /元代文人书院世界/);
  assert.doesNotMatch(relationshipExplorerSource, /relationshipExplorer\.title/);
  assert.match(relationshipExplorerLocaleSource, /关系网络/);
  assert.match(relationshipExplorerLocaleSource, /人物档案/);
  assert.match(relationshipExplorerLocaleSource, /静态历史世界/);
  assert.match(relationshipExplorerLocaleSource, /主要线索/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-topbar"/);
  assert.match(relationshipNetworkSource, /data-testid="world-relationship-story-panel"/);
  assert.match(relationshipNetworkSource, /data-testid="world-relationship-graph-toolbar"/);
  assert.match(relationshipExplorerSource, /data-testid="world-relationship-detail-panel"/);
  assert.match(relationshipExplorerModelSource, /const GRAPH_DEFAULT_ZOOM = 1\.1/);
  // The graph column and side panels use one fixed exploration height instead
  // of recomputing a parallel titlebar offset with viewport-height arithmetic.
  assert.match(relationshipExplorerModelSource, /const EXPLORER_PANEL_HEIGHT_PX = 1100/);
  assert.match(relationshipExplorerSource, /height: EXPLORER_PANEL_HEIGHT_PX,\s*minHeight: EXPLORER_PANEL_HEIGHT_PX/);
  assert.doesNotMatch(relationshipExplorerSource, /calc\(100vh - 92px\)/);
  // The graph canvas fills the remaining column height instead of a fixed square aspect ratio.
  assert.match(relationshipExplorerModelSource, /const EXPLORER_GRAPH_CANVAS_MIN_HEIGHT_PX = 360/);
  assert.match(relationshipNetworkSource, /flex: '1 1 360px',\s*minHeight: EXPLORER_GRAPH_CANVAS_MIN_HEIGHT_PX,\s*border/);
  assert.doesNotMatch(relationshipNetworkSource, /flex: 1, minHeight: 0, border/);
  assert.match(relationshipNetworkSource, /viewBox="0 0 1000 1000"/);
  assert.match(relationshipNetworkSource, /height: '100%', minHeight: EXPLORER_GRAPH_CANVAS_MIN_HEIGHT_PX, display: 'block'/);
  assert.match(relationshipExplorerSource, /setZoomScale\(GRAPH_DEFAULT_ZOOM\)/);
  assert.match(relationshipExplorerSource, /gridTemplateColumns: 'minmax\(212px,244px\) minmax\(0,1fr\) minmax\(300px,340px\)'/);
  assert.match(relationshipExplorerSource, /zoomScale/);
  assert.match(relationshipExplorerSource, /zoomIn/);
  assert.match(relationshipExplorerSource, /zoomOut/);
  assert.match(relationshipExplorerSource, /resetView/);
  assert.match(relationshipExplorerSource, /detailCollapsed/);
  assert.match(relationshipExplorerSource, /onToggleDetailPanel/);
  assert.match(relationshipNetworkSource, /PanelRightOpen/);
  assert.match(relationshipNetworkSource, /PanelRightClose/);
  assert.match(relationshipExplorerSource, /const collapsedExplorerColumns = 'minmax\(212px,244px\) minmax\(0,1fr\)'/);
  assert.match(relationshipExplorerModelSource, /function relationshipGraphEdgeLabelPosition/);
  assert.match(relationshipExplorerModelSource, /CENTER_GRAPH_CARD_BOUNDS/);
  assert.match(relationshipExplorerModelSource, /TARGET_GRAPH_CARD_BOUNDS/);
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

test('world relationship explorer right profile action is a single white primary action', () => {
  const profileSummaryStart = relationshipExplorerSource.indexOf('function ProfileSummary');
  const profileSummaryEnd = relationshipExplorerSource.indexOf('function RelationshipDetailPanel');
  const profileSummarySource = relationshipExplorerSource.slice(profileSummaryStart, profileSummaryEnd);

  assert.match(profileSummarySource, /style=\{\{ \.\.\.paperPrimaryButton, flex: 1, color: '#fff' \}\}/);
  assert.match(profileSummarySource, /displayRelationshipEvidenceText\(clue\.text\)/);
  assert.doesNotMatch(profileSummarySource, /onBrowsePeers/);
  assert.doesNotMatch(profileSummarySource, /profile\.peers/);
});

test('world relationship explorer profile action routes to source detail character profile', () => {
  const explorerPropsStart = relationshipExplorerSource.indexOf('type WorldRelationshipExplorerProps = {');
  const explorerPropsEnd = relationshipExplorerSource.indexOf('};', explorerPropsStart);
  const explorerPropsSource = relationshipExplorerSource.slice(explorerPropsStart, explorerPropsEnd);

  assert.match(explorerPropsSource, /readonly onViewCharacter\?: \(character: WorldCharacter\) => void;/);
  assert.match(
    worldDetailTemplateSource,
    /<WorldRelationshipExplorer[\s\S]*?onSelectCharacter=\{setSelectedCharacterId\}[\s\S]*?onViewCharacter=\{props\.onViewCharacter\}/,
  );
  assert.match(
    relationshipExplorerSource,
    /const openCharacterProfile = \(characterId: string\) => \{[\s\S]*?const character = characters\.find\(\(item\) => item\.id === characterId\) \?\? null;[\s\S]*?if \(character && onViewCharacter\) \{[\s\S]*?onViewCharacter\(character\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?onSelectCharacter\?\.\(characterId\);[\s\S]*?\};/,
  );
  assert.match(relationshipExplorerSource, /<ProfileFallback[\s\S]*?onOpenProfile=\{openCharacterProfile\}/);
  assert.match(relationshipExplorerSource, /<RelationshipDetail[\s\S]*?onOpenCharacter=\{openCharacterProfile\}/);
  assert.match(relationshipExplorerSource, /<ProfileSummary[\s\S]*?onOpenCharacter=\{openCharacterProfile\}/);
});

test('world relationship explorer cleans evidence prefixes across side details', () => {
  const relationshipDetailStart = relationshipExplorerSource.indexOf('function RelationshipDetail');
  const relationshipDetailEnd = relationshipExplorerSource.indexOf('function ClueDetail');
  const relationshipDetailSource = relationshipExplorerSource.slice(relationshipDetailStart, relationshipDetailEnd);
  const clueDetailStart = relationshipExplorerSource.indexOf('function ClueDetail');
  const clueDetailEnd = relationshipExplorerSource.indexOf('function ProfileSummary');
  const clueDetailSource = relationshipExplorerSource.slice(clueDetailStart, clueDetailEnd);

  assert.match(relationshipDetailSource, /displayRelationshipEvidenceText\(edge\.evidenceTexts\[0\] \?\? t\('WorldDetail\.paper\.relationshipExplorer\.relation\.noEvidence'\)\)/);
  assert.match(relationshipDetailSource, /style=\{\{ \.\.\.paperPrimaryButton, width: '100%', marginTop: 16, color: '#fff' \}\}/);
  assert.match(clueDetailSource, /displayRelationshipEvidenceText\(clue\.evidenceText\)/);
});

test('world relationship graph person nodes do not cast card drop shadows', () => {
  assert.doesNotMatch(relationshipNetworkSource, /0 18px 36px rgba\(25,70,45,\.22\)/);
  assert.doesNotMatch(relationshipNetworkSource, /0 14px 28px rgba\(42,77,58,\.16\)/);
  assert.doesNotMatch(relationshipNetworkSource, /0 8px 20px rgba\(86,75,52,\.09\)/);
  assert.match(relationshipNetworkSource, /boxShadow: '0 0 0 2px rgba\(37,99,77,\.20\)'/);
});
