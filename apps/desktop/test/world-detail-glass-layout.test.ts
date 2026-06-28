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
  'world-detail-template-model.ts',
].map(readWorldSource).join('\n');
const desktopFeatureCoverageSource = readFileSync(
  resolve(import.meta.dirname, '../../../.nimi/spec/desktop/kernel/tables/desktop-feature-coverage.yaml'),
  'utf8',
);

test('world surface feature coverage points at the active glass layout contract', () => {
  assert.match(desktopFeatureCoverageSource, /scenario_id: world\.surface-layout/);
  assert.match(desktopFeatureCoverageSource, /spec_path: apps\/desktop\/test\/world-detail-glass-layout\.test\.ts/);
  assert.doesNotMatch(desktopFeatureCoverageSource, /world-detail-bento-layout\.test\.ts/);
});

test('world detail hard-cuts to the glass setting discovery surface', () => {
  assert.match(worldTemplateSource, /data-testid="world-detail-glass-layout"/);
  assert.match(worldTemplateSource, /function DetailHero/);
  assert.match(worldTemplateSource, /function HeroStats/);
  assert.match(worldTemplateSource, /function SourceDiscoveryPanel/);
  assert.match(worldTemplateSource, /world-detail-glass-grid/);
  assert.match(worldTemplateSource, /data-testid="world-detail-source-discovery"/);
  assert.doesNotMatch(worldTemplateSource, /composition\.sections/);
  assert.doesNotMatch(worldTemplateSource, /world-detail-root/);
  assert.doesNotMatch(worldTemplateSource, /world-detail-dashboard/);
  assert.doesNotMatch(worldTemplateSource, /WorldDashboardSection/);
});

test('world detail product semantics stay setting-first and source-first', () => {
  assert.match(worldTemplateSource, /WorldDetail\.glass\.lore\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.glass\.lore\.rulesTitle/);
  assert.match(worldTemplateSource, /WorldDetail\.glass\.characters\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.glass\.timeline\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.glass\.scenes\.title/);
  assert.match(worldTemplateSource, /WorldDetail\.glass\.sourceDiscovery\.primarySource/);
  assert.match(worldTemplateSource, /onMaterializeSource/);
  assert.match(worldTemplateSource, /SourceDiscoveryPanel/);
  assert.match(worldTemplateSource, /data-testid="world-detail-source-discovery"/);
  assert.match(worldTemplateSource, /Current world time is calculated from initial world time and timeflow ratio\./);
  assert.doesNotMatch(worldTemplateSource, /Transit/);
  assert.doesNotMatch(worldTemplateSource, /Enter World/);
  assert.doesNotMatch(worldTemplateSource, /Active Now/);
  assert.doesNotMatch(worldTemplateSource, /accepting arrivals/);
});

test('world detail keeps source quick sheets but does not start chat before materialization', () => {
  assert.match(worldTemplateSource, /WorldCharacterQuickSheet/);
  assert.match(worldTemplateSource, /WorldSceneQuickSheet/);
  assert.match(worldTemplateSource, /onMaterializeSource/);
  assert.match(worldTemplateSource, /onViewCharacter/);
  assert.match(worldTemplateSource, /Chat is materialized only after Runtime creates a device-local LocalAgent\./);
});
