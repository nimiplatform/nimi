import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  mapCultivationRingsData,
  mapRealmConstellationData,
  resolveCoreRuleLayout,
  resolveDashboardSecondaryLayout,
  resolveExtendedLayout,
  WORLD_DETAIL_SECTION_ORDER,
} from '../src/shell/renderer/features/world/world-detail-layout.ts';
import type { WorldSemanticData } from '../src/shell/renderer/features/world/world-detail-types.ts';

// scenario_id: world.surface-layout
const worldTemplateSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/world-xianxia-template.tsx'),
  'utf8',
);
const worldOverviewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-overview-sections.tsx'),
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
      { label: 'Cycle', value: 'yes' },
      { label: 'Mercy', value: 'no' },
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

test('world detail section order remains fixed and deterministic', () => {
  assert.deepEqual(WORLD_DETAIL_SECTION_ORDER, [
    'hero',
    'dashboard',
    'core-rules',
    'timeline',
    'scenes',
    'agents',
    'extended',
  ]);
});

test('dashboard secondary layout promotes chronology into a full-width strip when content is rich', () => {
  assert.deepEqual(
    resolveDashboardSecondaryLayout({
      hasRuntimeFacts: true,
      recommendedAgentsCount: 3,
      chronologyFactCount: 3,
      hasLatestAudit: false,
    }).cards,
    [
      { key: 'runtimeFacts', span: 4 },
      { key: 'recommendedAgents', span: 8 },
      { key: 'chronologyLanguage', span: 12 },
    ],
  );
  assert.deepEqual(
    resolveDashboardSecondaryLayout({
      hasRuntimeFacts: true,
      recommendedAgentsCount: 2,
      chronologyFactCount: 0,
      hasLatestAudit: false,
    }).cards,
    [
      { key: 'runtimeFacts', span: 6 },
      { key: 'recommendedAgents', span: 6 },
    ],
  );
  assert.deepEqual(
    resolveDashboardSecondaryLayout({
      hasRuntimeFacts: true,
      recommendedAgentsCount: 0,
      chronologyFactCount: 0,
      hasLatestAudit: false,
    }).cards,
    [{ key: 'runtimeFacts', span: 12 }],
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

test('extended layout keeps deterministic 8/4 split when knowledge and governance coexist', () => {
  assert.deepEqual(
    resolveExtendedLayout({ hasKnowledge: true, hasGovernance: true }).cards,
    [
      { key: 'knowledge', span: 8 },
      { key: 'governance', span: 4 },
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

test('world detail template keeps fixed nine-card first page agent budget and stable test surfaces', () => {
  assert.match(worldContentSource, /buildVisibleAgentGroups\(agents, 9, expanded\)/);
  assert.match(worldContentSource, /totalCount > 9/);
  assert.match(worldTemplateSource, /data-testid="world-detail-root"/);
  assert.match(worldOverviewSource, /data-testid="world-detail-dashboard"/);
  assert.match(worldOverviewSource, /dataTestId="world-detail-core-rules"/);
  assert.match(worldContentSource, /dataTestId="world-detail-timeline"/);
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
  }
});
