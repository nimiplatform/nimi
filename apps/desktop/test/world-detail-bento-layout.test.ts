import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  NARRATIVE_WORLD_DETAIL_COMPOSITION,
  OASIS_WORLD_DETAIL_COMPOSITION,
  mapCultivationRingsData,
  mapRealmConstellationData,
  resolveCoreRuleLayout,
} from '../src/shell/renderer/features/world/world-detail-layout.js';
import type { WorldSemanticData } from '../src/shell/renderer/features/world/world-detail-types.js';

// scenario_id: world.surface-layout
const worldTemplateSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-template.tsx'),
  'utf8',
);
const worldOverviewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-overview-sections.tsx'),
  'utf8',
);
const worldCoreRulesSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-core-rules-section.tsx'),
  'utf8',
);
const worldContentSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-content-sections.tsx'),
  'utf8',
);
const worldPrimitivesSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-primitives.tsx'),
  'utf8',
);
const worldVisualsSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-visuals.tsx'),
  'utf8',
);
const localesEnSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/locales/en.json'),
  'utf8',
);
const localesZhSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/locales/zh.json'),
  'utf8',
);

function makeSemantic(): WorldSemanticData {
  return {
    operationTitle: 'Rule Engine',
    operationDescription: 'How the world stays coherent.',
    operationRules: [
      { key: 'cycle', title: 'Cycle', value: 'yes' },
      { key: 'mercy', title: 'Mercy', value: 'no' },
    ],
    powerSystems: [
      {
        name: 'Immortal Path',
        description: 'Ascension through trial.',
        levels: Array.from({ length: 14 }, (_, index) => ({
          name: `Level ${index + 1}`,
          description: `Description ${index + 1}`,
          extra: `Extra ${index + 1}`,
        })),
        rules: [],
      },
      {
        name: 'Artifact Bonding',
        description: 'Secondary system.',
        levels: [{ name: 'Bonded' }],
        rules: [],
      },
    ],
    standaloneLevels: [],
    taboos: [{ name: 'Do not fracture causality', description: 'Hard fail.' }],
    topology: {
      type: 'GRAPH',
      boundary: 'BOUNDED',
      dimensions: '3',
      realms: Array.from({ length: 10 }, (_, index) => ({
        name: `Realm ${index + 1}`,
        description: `Realm Description ${index + 1}`,
        accessibility: index % 3 === 0 ? 'OPEN' : index % 3 === 1 ? 'RESTRICTED' : 'SEALED',
      })),
    },
    causality: {
      type: 'KARMA',
      karmaEnabled: true,
      fateWeight: 0.75,
    },
    languages: [{ name: 'Common Tongue', category: 'common', description: 'Widely spoken.' }],
    worldviewEvents: [],
    worldviewSnapshots: [],
    hasContent: true,
  };
}

test('narrative world detail composition remains fixed and includes the current quick-nav contract', () => {
  assert.deepEqual(
    NARRATIVE_WORLD_DETAIL_COMPOSITION.sections.map((section) => section.key),
    ['hero', 'dashboard', 'core-rules', 'recommended', 'scenes', 'timeline', 'agents', 'extended'],
  );
  assert.deepEqual(
    NARRATIVE_WORLD_DETAIL_COMPOSITION.sections
      .filter((section) => section.showInQuickNav)
      .map((section) => [section.anchorId, section.quickNavLabelKey]),
    [
      ['world-detail-rules', 'WorldDetail.xianxia.v2.quickNav.rules'],
      ['world-detail-recommended', 'WorldDetail.xianxia.v2.quickNav.characters'],
      ['world-detail-scenes', 'WorldDetail.xianxia.v2.quickNav.scenes'],
      ['world-detail-timeline', 'WorldDetail.xianxia.v2.quickNav.timeline'],
      ['world-detail-agents', 'WorldDetail.xianxia.v2.quickNav.roster'],
      ['world-detail-governance-card', 'WorldDetail.xianxia.v2.quickNav.governance'],
    ],
  );
});

test('oasis world detail composition stays distinct from narrative-only sections', () => {
  assert.deepEqual(
    OASIS_WORLD_DETAIL_COMPOSITION.sections.map((section) => section.key),
    ['hero', 'oasis-identity', 'dashboard', 'scenes', 'timeline', 'agents'],
  );
  assert.equal(
    OASIS_WORLD_DETAIL_COMPOSITION.sections.some((section) => section.key === 'core-rules' || section.key === 'recommended' || section.key === 'extended'),
    false,
  );
});

test('core rules layout expands dense visual cards and keeps support cards compact', () => {
  const cards = resolveCoreRuleLayout({
    operationRuleCount: 2,
    hasOperationDescription: true,
    tabooCount: 1,
    cultivationLevelCount: 12,
    extraPowerSystemCount: 1,
    topologyRealmCount: 8,
    topologyMetaCount: 3,
    causalityFieldCount: 3,
    languageCount: 1,
    languageHasSamples: false,
  }).cards;
  assert.deepEqual(
    cards.map((card) => [card.key, card.span]),
    [
      ['operation', 8],
      ['taboos', 4],
      ['cultivation', 8],
      ['constellation', 8],
      ['causality', 6],
      ['languages', 4],
    ],
  );
});

test('core rules layout stays compact when only lightweight textual cards remain', () => {
  const cards = resolveCoreRuleLayout({
    operationRuleCount: 1,
    hasOperationDescription: false,
    tabooCount: 1,
    cultivationLevelCount: 0,
    extraPowerSystemCount: 0,
    topologyRealmCount: 0,
    topologyMetaCount: 0,
    causalityFieldCount: 2,
    languageCount: 0,
    languageHasSamples: false,
  }).cards;
  assert.deepEqual(
    cards.map((card) => [card.key, card.span]),
    [
      ['operation', 4],
      ['taboos', 4],
      ['causality', 4],
    ],
  );
});

test('cultivation rings mapping caps levels at 12 and keeps extra systems compact', () => {
  const mapped = mapCultivationRingsData(makeSemantic());
  assert.ok(mapped);
  assert.equal(mapped?.levels.length, 12);
  assert.equal(mapped?.extraSystems.length, 1);
  assert.equal(mapped?.systemName, 'Immortal Path');
});

test('cultivation rings fallback uses standalone levels when no primary system exists', () => {
  const semantic = makeSemantic();
  semantic.powerSystems = [];
  semantic.standaloneLevels = [{ name: 'Standalone One' }, { name: 'Standalone Two' }];
  const mapped = mapCultivationRingsData(semantic);
  assert.ok(mapped);
  assert.equal(mapped?.systemName, 'Rule Engine');
  assert.equal(mapped?.levels.length, 2);
});

test('realm constellation supports meta-only mode and trims realm nodes to eight', () => {
  const semantic = makeSemantic();
  const mapped = mapRealmConstellationData(semantic);
  assert.ok(mapped);
  assert.equal(mapped?.realms.length, 8);

  semantic.topology = { type: 'GRAPH', boundary: 'BOUNDED', dimensions: '2', realms: [] };
  const metaOnly = mapRealmConstellationData(semantic);
  assert.ok(metaOnly);
  assert.equal(metaOnly?.realms.length, 0);

  semantic.topology = { type: null, boundary: null, dimensions: null, realms: [] };
  assert.equal(mapRealmConstellationData(semantic), null);
});

test('world detail pages are composition-driven and expose stable test surfaces', () => {
  assert.match(worldTemplateSource, /export function NarrativeWorldDetailPage/);
  assert.match(worldTemplateSource, /export function OasisWorldDetailPage/);
  assert.match(worldTemplateSource, /composition\.sections/);
  assert.match(worldTemplateSource, /showInQuickNav/);
  assert.doesNotMatch(worldTemplateSource, /\['world-detail-rules', t\('WorldDetail\.xianxia\.v2\.quickNav\.rules'\)\]/);
  assert.match(worldTemplateSource, /data-testid="world-detail-root"/);
  assert.match(worldOverviewSource, /data-testid="world-detail-dashboard"/);
  assert.match(worldCoreRulesSource, /dataTestId="world-detail-core-rules"/);
  assert.match(worldContentSource, /dataTestId="world-detail-timeline"/);
  assert.match(worldContentSource, /buildVisibleAgentGroups\(agents, 9, expanded\)/);
  assert.match(worldContentSource, /totalCount > 9/);
});

test('oasis scene CTA mapping uses stable scene ids instead of display names', () => {
  assert.match(worldTemplateSource, /oasis-scene-plaza/);
  assert.match(worldTemplateSource, /oasis-scene-transit-hub/);
  assert.match(worldTemplateSource, /selectedScene\.id/);
  assert.doesNotMatch(worldTemplateSource, /oasisSceneActionKeyByName/);
});

test('overview and content boundaries stay explicit after the refactor', () => {
  assert.doesNotMatch(worldOverviewSource, /export function WorldRuntimeFactsSection/);
  assert.doesNotMatch(worldOverviewSource, /export function WorldLanguageFactsSection/);
  assert.match(worldContentSource, /dataTestId="world-detail-runtime-facts-card"/);
  assert.match(worldContentSource, /data-testid="world-detail-governance-card"/);
  assert.match(worldContentSource, /<WorldKnowledgeCard lorebooks=\{publicAssets\.lorebooks\} \/>/);
  assert.match(worldContentSource, /<WorldRuntimeSummaryCard/);
  assert.match(worldContentSource, /<WorldGovernanceCard audits=\{audits\} auditsLoading=\{auditsLoading\} \/>/);
  assert.doesNotMatch(worldContentSource, /runtimeFacts\.flowRatio/);
  assert.doesNotMatch(worldContentSource, /WorldDetail\.xianxia\.v2\.runtimeFacts\.flowRatio/);
  assert.doesNotMatch(worldContentSource, /mutation\.targetPath/);
  assert.doesNotMatch(worldContentSource, /mutation\.reason/);
});

test('world detail visuals honor reduced motion and expose visual card roots', () => {
  assert.match(worldPrimitivesSource, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(worldTemplateSource, /animation: prefersReducedMotion \? undefined : 'pulse-glow/);
  assert.match(worldOverviewSource, /animation: prefersReducedMotion \? undefined : 'float-card/);
  assert.match(worldVisualsSource, /dataTestId="world-detail-realm-constellation"/);
});

test('world detail visual localization keys exist in English and Chinese locales', () => {
  for (const source of [localesEnSource, localesZhSource]) {
    assert.match(source, /"powerSystem":/);
    assert.match(source, /"constellationTitle":/);
    assert.match(source, /"systemLabels":/);
    assert.match(source, /"levelUp":/);
    assert.match(source, /"governanceLock":/);
  }
});
