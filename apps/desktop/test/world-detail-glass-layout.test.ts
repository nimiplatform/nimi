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
  // Left people browser, center relationship network, right character profile.
  assert.match(relationshipExplorerSource, /function PeoplePanel/);
  assert.match(relationshipExplorerSource, /function RelationshipNetwork/);
  assert.match(relationshipExplorerSource, /function ProfileSummary/);
  // Single-character worlds still resolve to a profile instead of an empty graph.
  assert.match(relationshipExplorerSource, /function ProfileFallback/);
  // People filters are localized through a key template, not hardcoded labels.
  assert.match(relationshipExplorerSource, /relationshipExplorer\.peopleList\.filters\.\$\{key\}/);
  assert.match(relationshipExplorerSource, /const FILTER_KEYS[^=]*=\s*\['all', 'featured', 'literati', 'academy', 'open'\]/);
  assert.match(relationshipExplorerLocaleSource, /元代文人书院世界/);
  assert.match(relationshipExplorerLocaleSource, /关系网络/);
  assert.match(relationshipExplorerLocaleSource, /人物档案/);
  assert.match(relationshipExplorerLocaleSource, /静态历史世界/);
  assert.match(relationshipExplorerLocaleSource, /作品与资料线索/);
  assert.doesNotMatch(relationshipExplorerSource, /source\.tags|sourceTags|待挂接|暂无关系证据|未匹配|数据覆盖|证据覆盖/);
  assert.doesNotMatch(relationshipExplorerLocaleSource, /source\.tags|sourceTags|待挂接|暂无关系证据|未匹配|数据覆盖|证据覆盖/);
});
