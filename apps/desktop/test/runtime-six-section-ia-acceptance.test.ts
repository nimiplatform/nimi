/**
 * Runtime ordinary-tasks acceptance.
 *
 * Acceptance coverage for the canonical Runtime/Desktop contracts under
 * `.nimi/spec`:
 *
 *  - the Runtime surface renders exactly the six-section IA
 *    (Overview / Profiles / Models / Cloud Connectors / Environment / Advanced);
 *  - no surviving `recommend` / `catalog` / `data-management` / `performance`
 *    top-level entries and no `AI Runtime` label;
 *  - the Runtime Surface Cleanup table merges are honoured:
 *      recommend + local + catalog            -> Models
 *      data-management + runtime (Operations)  -> Environment
 *      performance                             -> Advanced
 *  - each of the nine Runtime Ordinary Tasks is reachable in the six-section IA
 *    without raw-log reading.
 *
 * E2E posture: a real WebdriverIO screenshot of the six-section Runtime is not
 * producible in the current renderer-shell harness. These renderer-markup /
 * source-assertion tests are the honest substitute; the whole-product
 * screenshot / E2E matrix is owned by app acceptance.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { RUNTIME_PAGE_META } from '../src/shell/renderer/features/runtime-config/runtime-config-meta-v11';
import { RUNTIME_SIDEBAR_ITEMS } from '../src/shell/renderer/features/runtime-config/runtime-config-sidebar';
import { normalizePageIdV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import { readDesktopLocale } from './helpers/read-desktop-locale';

const RUNTIME_CONFIG_DIR = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config',
);

function readRuntimeConfigSource(name: string): string {
  return readFileSync(path.join(RUNTIME_CONFIG_DIR, name), 'utf8');
}

const sidebarSource = readRuntimeConfigSource('runtime-config-sidebar.tsx');
const panelViewSource = readRuntimeConfigSource('runtime-config-panel-view.tsx');
const modelsPageSource = readRuntimeConfigSource('runtime-config-page-models.tsx');
const environmentPageSource = readRuntimeConfigSource('runtime-config-page-environment.tsx');
const advancedPageSource = readRuntimeConfigSource('runtime-config-page-advanced.tsx');
const overviewPageSource = readRuntimeConfigSource('runtime-config-page-overview.tsx');
const profilesPageSource = readRuntimeConfigSource('runtime-config-page-profiles.tsx');
const profilesLibraryPanelSource = readRuntimeConfigSource('runtime-config-profile-library-panel.tsx');
const profilesManagementSectionsSource = readRuntimeConfigSource('runtime-config-profile-management-sections.tsx');
const cloudPageSource = readRuntimeConfigSource('runtime-config-page-cloud.tsx');
const runtimeDepsPageSource = readRuntimeConfigSource('runtime-config-page-runtime.tsx');
const runtimeOverviewTabSource = readRuntimeConfigSource('runtime-config-runtime-overview-tab.tsx');
const runtimeNodeMatrixSource = readRuntimeConfigSource('runtime-config-runtime-node-matrix.tsx');

const CANONICAL_SIX = [
  'overview',
  'profiles',
  'models',
  'cloud',
  'environment',
  'advanced',
] as const;

// Retired top-level entries. These were either standalone sections collapsed by
// the Runtime Surface Cleanup table or never-ordinary developer surfaces.
const RETIRED_TOP_LEVEL = [
  'recommend',
  'catalog',
  'data-management',
  'performance',
  'local',
  'runtime',
  'mods',
  'mod-developer',
] as const;

// ---------------------------------------------------------------------------
// Task 1 — Six-section IA acceptance
// ---------------------------------------------------------------------------

test('Runtime renders exactly the canonical six-section IA in order', () => {
  const ids = RUNTIME_SIDEBAR_ITEMS.map((item) => item.id);
  assert.deepEqual(ids, [...CANONICAL_SIX], 'sidebar IA must be the canonical six in order');
  assert.equal(RUNTIME_SIDEBAR_ITEMS.length, 6, 'exactly six top-level sections');

  const labels = RUNTIME_SIDEBAR_ITEMS.map((item) => item.label);
  assert.deepEqual(labels, [
    'Overview',
    'Profiles',
    'Models',
    'Cloud Connectors',
    'Environment',
    'Advanced',
  ]);
});

test('RUNTIME_PAGE_META covers exactly the six sections, no retired ids', () => {
  assert.deepEqual(Object.keys(RUNTIME_PAGE_META).sort(), [...CANONICAL_SIX].sort());
  for (const retired of RETIRED_TOP_LEVEL) {
    assert.equal(
      retired in RUNTIME_PAGE_META,
      false,
      `retired id "${retired}" must not be a Runtime page meta entry`,
    );
  }
});

test('no retired top-level entry survives in the sidebar definition', () => {
  for (const retired of RETIRED_TOP_LEVEL) {
    assert.doesNotMatch(
      sidebarSource,
      new RegExp(`id:\\s*'${retired}'`),
      `retired top-level id "${retired}" must not appear in the sidebar source`,
    );
  }
});

test('no "AI Runtime" label survives anywhere in the Runtime surface', () => {
  // Product manual: `AI Runtime` should not remain the final ordinary label.
  for (const source of [
    sidebarSource,
    panelViewSource,
    modelsPageSource,
    environmentPageSource,
    advancedPageSource,
    overviewPageSource,
    profilesPageSource,
  ]) {
    assert.doesNotMatch(source, /AI Runtime/, 'no "AI Runtime" label may survive');
  }
  // The panel title and section label are both the ordinary final label "Runtime".
  assert.match(panelViewSource, /runtimeConfig\.panel\.title[^\n]*'Runtime'/);
});

test('panel view mounts a page root for each of the six sections, and no others', () => {
  for (const id of CANONICAL_SIX) {
    assert.match(
      panelViewSource,
      new RegExp(`activePage === '${id}'`),
      `panel view must branch on '${id}'`,
    );
    assert.match(
      panelViewSource,
      new RegExp(`runtimePageRoot\\('${id}'\\)`),
      `panel view must mount a stable page root for '${id}'`,
    );
  }
  for (const retired of RETIRED_TOP_LEVEL) {
    assert.doesNotMatch(
      panelViewSource,
      new RegExp(`activePage === '${retired}'`),
      `panel view must not branch on retired id "${retired}"`,
    );
  }
});

test('normalizePageIdV11 collapses every retired id back to overview', () => {
  // recommend / local / catalog / runtime / data-management / performance
  // (Runtime Surface Cleanup merges) and mods / mod-developer (never ordinary).
  for (const retired of RETIRED_TOP_LEVEL) {
    assert.equal(
      normalizePageIdV11(retired),
      'overview',
      `retired id "${retired}" must not normalize to an ordinary section`,
    );
  }
  for (const id of CANONICAL_SIX) {
    assert.equal(normalizePageIdV11(id), id);
  }
});

// ---------------------------------------------------------------------------
// Runtime Surface Cleanup table — section merges
// ---------------------------------------------------------------------------

test('Models section absorbs recommend + local + catalog (Runtime Surface Cleanup)', () => {
  // recommend + local (Local Models) + catalog -> models
  assert.match(modelsPageSource, /RecommendPage/, 'Models absorbs the recommend surface');
  assert.match(modelsPageSource, /LocalPage/, 'Models absorbs the Local Models surface');
  assert.match(modelsPageSource, /CatalogPage/, 'Models absorbs the catalog surface');
  // The three are sub-tabs inside one section, not top-level IA entries.
  assert.match(modelsPageSource, /runtime-models-subtab:/);
  assert.match(modelsPageSource, /E2E_IDS\.runtimeModelsPane\('recommend'\)/);
  assert.match(modelsPageSource, /E2E_IDS\.runtimeModelsPane\('installed'\)/);
  assert.match(modelsPageSource, /E2E_IDS\.runtimeModelsPane\('catalog'\)/);
});

test('Environment section absorbs data-management + runtime operations', () => {
  // data-management + runtime (Operations) -> environment
  assert.match(environmentPageSource, /RuntimePage/, 'Environment absorbs the runtime operations surface');
  assert.match(environmentPageSource, /DataManagementPage/, 'Environment absorbs data management');
  assert.match(environmentPageSource, /runtime-environment-subtab:/);
  assert.match(environmentPageSource, /E2E_IDS\.runtimeEnvironmentPane\('dependencies'\)/);
  assert.match(environmentPageSource, /E2E_IDS\.runtimeEnvironmentPane\('data'\)/);
});

test('Advanced section absorbs performance and excludes retired Mods', () => {
  // performance -> advanced; Mods is retired, not developer-gated.
  assert.match(advancedPageSource, /PerformancePage/, 'Advanced absorbs the performance surface');
  assert.doesNotMatch(advancedPageSource, /ModsPage|developerMode|runtime-advanced-pane:developer/);
});

test('sidebar locale bundle exposes the six section labels and no retired label', () => {
  for (const locale of ['en', 'zh']) {
    const bundle = readDesktopLocale(locale);
    const sidebar = bundle.runtimeConfig?.sidebar;
    assert.ok(sidebar, `${locale}: runtimeConfig.sidebar must exist`);
    for (const id of CANONICAL_SIX) {
      assert.equal(typeof sidebar[id], 'string', `${locale}: sidebar.${id} must be a string`);
      assert.ok(sidebar[id].length > 0, `${locale}: sidebar.${id} must be non-empty`);
    }
    assert.equal(sidebar.section?.runtime, locale === 'zh' ? sidebar.section.runtime : 'Runtime');
  }
});

// ---------------------------------------------------------------------------
// Task 2 — Nine ordinary Runtime tasks reachable in the six-section IA
// ---------------------------------------------------------------------------
//
// Each task maps to a concrete section / surface. The assertions prove the
// surface that satisfies the task exists and is reachable from the six-section
// IA — not buried behind raw-log reading.

test('ordinary task 1: check whether the AI environment is ready (Overview)', () => {
  // Overview projects readiness: capability coverage + runtime daemon status.
  assert.match(overviewPageSource, /capabilityCoverageTitle/);
  assert.match(overviewPageSource, /runtimeDaemonTitle/);
  assert.match(overviewPageSource, /DaemonStatusBadge/);
  // Daemon issues are projected as humanized guidance, not raw logs.
  assert.match(overviewPageSource, /describeRuntimeDaemonIssue/);
  assert.equal(RUNTIME_PAGE_META.overview.name, 'Overview');
  assert.match(RUNTIME_PAGE_META.overview.description, /readiness/i);
});

test('ordinary task 2: see the account Default Profile for new scopes (Profiles)', () => {
  // Runtime > Profiles shows the account default template without projecting a
  // hidden current-scope AIConfig origin.
  assert.match(profilesPageSource, /profileLibrary\.loadAccountDefault\(\)/);
  assert.doesNotMatch(profilesPageSource, /currentOrigin/);
  assert.doesNotMatch(profilesPageSource, /aiConfig\.profileOrigin/);
});

test('ordinary task 3: import / edit / export portable profiles (Profiles)', () => {
  assert.match(profilesLibraryPanelSource, /runtime-profiles-account-library/);
  assert.match(profilesPageSource, /runtime-profiles-create/);
  assert.match(profilesManagementSectionsSource, /runtime-profiles-import/);
  assert.match(profilesManagementSectionsSource, /runtime-profiles-export/);
  assert.match(profilesPageSource, /profileLibrary\.delete\(entry\.profileId\)/);
  assert.match(profilesManagementSectionsSource, /profileJsonText/);
  assert.doesNotMatch(profilesManagementSectionsSource, /runtime-profiles-factory-restore/);
  assert.doesNotMatch(profilesPageSource, /ModelConfigAiModelHub/);
});

test('ordinary task 4: Runtime Profiles does not apply to an implicit scope', () => {
  // Scope profile apply lives in explicit app/module/feature surfaces.
  assert.doesNotMatch(profilesPageSource, /useModelConfigProfileController/);
  assert.doesNotMatch(profilesPageSource, /surface\.aiProfile\.apply\(scopeRef, profileId\)/);
  assert.doesNotMatch(profilesPageSource, /profile\.onApply/);
});

test('ordinary task 5: install / remove local models by capability (Models)', () => {
  // Models hosts the local model center; capability-scoped browse/install/remove.
  assert.match(modelsPageSource, /LocalPage/);
  assert.match(modelsPageSource, /CatalogPage/);
  assert.match(RUNTIME_PAGE_META.models.description, /install/i);
});

test('ordinary task 6: repair missing or broken Nimi-managed dependencies (Environment)', () => {
  // Environment > Dependencies & Engines hosts the runtime operations page,
  // which renders the RuntimeHealthSection (dependency/engine health + repair).
  assert.match(environmentPageSource, /tabDependencies/);
  assert.match(environmentPageSource, /RuntimePage/);
  assert.match(runtimeDepsPageSource, /RuntimeHealthSection/);
});

test('ordinary task 7: configure Cloud connectors after first-run (Cloud Connectors)', () => {
  assert.equal(RUNTIME_PAGE_META.cloud.name, 'Cloud Connectors');
  // Cloud connector create/update/delete goes through the SDK connector service.
  assert.match(cloudPageSource, /sdkCreateConnector/);
  assert.match(cloudPageSource, /sdkUpdateConnector/);
  assert.match(cloudPageSource, /sdkDeleteConnector/);
});

test('ordinary task 8: Environment exposes no ordinary data-root migration stub', () => {
  // Data-root relocation is not an admitted ordinary Desktop feature. The
  // Environment page must not ship a placeholder or pseudo action for it.
  assert.doesNotMatch(environmentPageSource, /runtime-environment-data-migration/);
  assert.doesNotMatch(environmentPageSource, /DataRootMigrationStub/);
  assert.doesNotMatch(environmentPageSource, /previewNimiDataMigration|runNimiDataMigration/);
});

test('ordinary task 9: see why an app/model/profile is unusable without raw logs', () => {
  // Runtime health projects humanized reason text, not raw logs.
  assert.match(runtimeDepsPageSource, /RuntimeHealthSection/);
  assert.match(runtimeNodeMatrixSource, /localSpeechReasonSummary/);
  // Overview projects capability coverage + daemon guidance as product copy.
  assert.match(overviewPageSource, /capabilitySourceUnavailable/);
  assert.match(runtimeOverviewTabSource, /describeRuntimeDaemonIssue/);
});
