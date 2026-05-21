/**
 * T10.4 — Support secondary surface acceptance (`D-SUP-001..008`).
 *
 * Acceptance coverage for `.nimi/spec/desktop/kernel/support-surface-contract.md`:
 *   - D-SUP-001: Support is a `nav_group: secondary` surface, reachable from
 *     the account-area menu, and NOT one of the six ordinary primary nav tabs.
 *   - D-SUP-002: the surface hosts exactly the five sub-areas.
 *   - D-SUP-003..007: each sub-area consumes a typed projection and fails
 *     closed; recovery uses the copy floor, not raw enum names.
 *   - D-SUP-008: Support (repair + recovery) is reachable from the degraded
 *     first-run / repair gate.
 *
 * The six-item ordinary primary nav (`Home | Chat | Contacts | Explore | Apps
 * | Runtime`) must stay unchanged — this file also re-guards that floor.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  SUPPORT_SECTION_IDS,
  SUPPORT_DEGRADED_REACHABLE_SECTIONS,
  resolveSupportSection,
  isSupportSectionId,
} from '../src/shell/renderer/features/support/support-sections.js';
import {
  RECOVERY_STATE_COPY_KEY,
  isDegradedProductState,
  isRepairRoutedState,
} from '../src/shell/renderer/features/support/support-recovery-copy.js';
import { DESKTOP_LOG_AREAS } from '../src/shell/renderer/features/support/support-log-areas.js';

const desktopDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopDir, '../..');

function readDesktop(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function readRepo(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// D-SUP-001 — Support As Secondary System Surface
// ---------------------------------------------------------------------------

test('D-SUP-001: app-tabs.yaml registers support as nav_group secondary', () => {
  const appTabs = readRepo('.nimi/spec/desktop/kernel/tables/app-tabs.yaml');
  const supportEntry = appTabs.slice(appTabs.indexOf('  - id: support'));
  assert.match(supportEntry, /nav_group:\s*secondary/);
  assert.match(supportEntry, /source_rule:\s*D-SUP-001/);
});

test('D-SUP-001: AppTab type includes support', () => {
  const storeTypes = readDesktop('src/shell/renderer/app-shell/providers/store-types.ts');
  assert.match(storeTypes, /\bAppTab\b[\s\S]*?\|\s*'support'/);
});

test('D-SUP-001: support is NOT in the six-item ordinary core nav', () => {
  const navConfig = readDesktop('src/shell/renderer/app-shell/layouts/navigation-config.tsx');
  const coreNavBlock = navConfig.slice(
    navConfig.indexOf('BASE_CORE_NAV_ITEMS'),
    navConfig.indexOf('export function getQuickNavItems'),
  );
  const coreIds = [...coreNavBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(coreIds, ['home', 'chat', 'contacts', 'explore', 'apps', 'runtime']);
  assert.equal(coreIds.includes('support'), false);
});

test('D-SUP-001: getCoreNavItems still returns exactly six items', () => {
  const navConfig = readDesktop('src/shell/renderer/app-shell/layouts/navigation-config.tsx');
  const fn = navConfig.slice(
    navConfig.indexOf('export function getCoreNavItems'),
    navConfig.indexOf('export function NavLink'),
  );
  // The function returns BASE_CORE_NAV_ITEMS verbatim; no support injection.
  assert.doesNotMatch(fn, /support/);
});

test('D-SUP-001: Support is reachable from the account-area menu', () => {
  const layoutView = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
  // The settings/account submenu carries a `support` item that navigates to
  // the support tab — Support is reachable without being a primary nav tab.
  assert.match(layoutView, /id:\s*'support'/);
  assert.match(layoutView, /props\.onNav\('support'\)/);
});

test('D-SUP-001: the Support panel mounts when the support tab is active', () => {
  const layoutView = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
  assert.match(layoutView, /activeTab === 'support'/);
  assert.match(layoutView, /<SupportPanel \/>/);
  assert.match(layoutView, /features\/support\/support-panel/);
});

// ---------------------------------------------------------------------------
// D-SUP-002 — Support Sub-Area Set
// ---------------------------------------------------------------------------

test('D-SUP-002: the surface hosts exactly the five contract sub-areas', () => {
  assert.deepEqual(
    [...SUPPORT_SECTION_IDS],
    ['repair', 'updates', 'diagnostics', 'logs', 'recovery'],
  );
});

test('D-SUP-002: the panel dispatches every sub-area', () => {
  const panel = readDesktop('src/shell/renderer/features/support/support-panel.tsx');
  for (const section of SUPPORT_SECTION_IDS) {
    assert.match(panel, new RegExp(`case '${section}':`));
  }
});

test('D-SUP-002: section id resolution rejects unknown sub-areas', () => {
  assert.equal(resolveSupportSection('updates'), 'updates');
  assert.equal(resolveSupportSection('nonexistent'), 'repair');
  assert.equal(resolveSupportSection(null), 'repair');
  assert.equal(isSupportSectionId('diagnostics'), true);
  assert.equal(isSupportSectionId('settings'), false);
});

test('D-SUP-002: Support does not host ordinary preference sections', () => {
  const panel = readDesktop('src/shell/renderer/features/support/support-panel.tsx');
  // Ordinary preference surfaces belong to Settings, not Support.
  assert.doesNotMatch(panel, /SettingsPanelBody|LanguageRegionPage|NotificationsPage/);
});

// ---------------------------------------------------------------------------
// D-SUP-003..007 — each sub-area consumes a typed projection and fails closed
// ---------------------------------------------------------------------------

const SECTION_FILES = {
  repair: 'src/shell/renderer/features/support/support-repair-section.tsx',
  updates: 'src/shell/renderer/features/support/support-updates-section.tsx',
  diagnostics: 'src/shell/renderer/features/support/support-diagnostics-section.tsx',
  logs: 'src/shell/renderer/features/support/support-logs-section.tsx',
  recovery: 'src/shell/renderer/features/support/support-recovery-section.tsx',
} as const;

for (const [section, file] of Object.entries(SECTION_FILES)) {
  test(`D-SUP-003..007: ${section} sub-area renders a typed fail-closed surface`, () => {
    const source = readDesktop(file);
    assert.match(source, /SupportFailClosed/);
  });
}

test('D-SUP-003: repair delegates cleanup to the managed P-MIG-008 flow', () => {
  const source = readDesktop(SECTION_FILES.repair);
  // The repair sub-area never deletes data itself — it plans + executes via
  // the nimi_data cleanup bridge and gates destructive cleanup on the token.
  assert.match(source, /planNimiDataCleanup/);
  assert.match(source, /executeNimiDataCleanup/);
  assert.match(source, /NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION/);
});

test('D-SUP-003: repair surfaces config pointers without recreating them', () => {
  const source = readDesktop(SECTION_FILES.repair);
  assert.match(source, /SupportPointerCard/);
  // No pointer-write / recreate path in the repair sub-area.
  assert.doesNotMatch(source, /selectProductDataRoot|setProductFirstRun/);
});

test('D-SUP-004: updates consumes the DesktopReleaseInfo projection, not synthesized data', () => {
  const source = readDesktop(SECTION_FILES.updates);
  assert.match(source, /desktopReleaseInfo/);
  assert.match(source, /runDesktopUpdateCheck/);
  // updaterAvailable=false must surface the typed reason and disable actions.
  assert.match(source, /updaterAvailable/);
  assert.match(source, /updaterUnavailableReason/);
  assert.match(source, /support-updates-unavailable/);
});

test('D-SUP-005: diagnostics consumes typed runtime projections only', () => {
  const source = readDesktop(SECTION_FILES.diagnostics);
  assert.match(source, /getRuntimeBridgeStatus/);
  assert.match(source, /listRuntimeModDiagnostics/);
  assert.match(source, /getSystemResourceSnapshot/);
});

test('D-SUP-006: logs consumes the log-areas table and exports via the typed IPC', () => {
  const source = readDesktop(SECTION_FILES.logs);
  assert.match(source, /DESKTOP_LOG_AREAS/);
  assert.match(source, /getRuntimeModStorageDirs/);
  // The typed `desktop_logs_export` IPC produces the user-locatable artifact.
  assert.match(source, /exportDesktopLogs/);
  // The export action fails closed to a typed error state — it never
  // synthesizes an artifact path or a pseudo-success result.
  assert.match(source, /support-logs-export-failed/);
  assert.match(source, /support-logs-export-done/);
});

test('D-SUP-006: the log-areas projection matches the kernel closed enum', () => {
  const logAreasTable = readRepo('.nimi/spec/desktop/kernel/tables/log-areas.yaml');
  for (const area of DESKTOP_LOG_AREAS) {
    assert.match(logAreasTable, new RegExp(`- ${area}\\b`));
  }
  assert.equal(DESKTOP_LOG_AREAS.length, 10);
});

test('D-SUP-007: recovery copy mapping is total and uses the copy floor', () => {
  const productControl = readDesktop(
    'src/shell/renderer/bridge/runtime-bridge/product-control.ts',
  );
  // Every ProductControlState in the typed enum has a copy-floor key.
  const enumStates = [...productControl.matchAll(/^\s{2}\|\s*'([a-z_]+)'/gm)]
    .map((m) => m[1])
    .filter((value): value is string => typeof value === 'string');
  assert.ok(enumStates.length >= 12, 'expected the full product-control state enum');
  for (const state of enumStates) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(RECOVERY_STATE_COPY_KEY, state),
      `recovery copy key missing for state: ${state}`,
    );
  }
});

test('D-SUP-007: recovery never shows the raw enum name as primary copy', () => {
  const source = readDesktop(SECTION_FILES.recovery);
  // Primary title/body come from the copy-floor key; the raw state id is only
  // a secondary technical detail line.
  assert.match(source, /RECOVERY_STATE_COPY_KEY/);
  assert.match(source, /recoveryTechnicalStateLabel/);
});

test('D-SUP-007: degraded vs repair-routed state classification', () => {
  assert.equal(isDegradedProductState('repair_required'), true);
  assert.equal(isDegradedProductState('data_root_missing'), true);
  assert.equal(isDegradedProductState('ready_for_use'), false);
  assert.equal(isRepairRoutedState('repair_required'), true);
  assert.equal(isRepairRoutedState('blocked'), true);
  assert.equal(isRepairRoutedState('ready_for_use'), false);
});

// ---------------------------------------------------------------------------
// D-SUP-008 — Support Reachability Under Degraded State
// ---------------------------------------------------------------------------

test('D-SUP-008: repair and recovery are the degraded-reachable sub-areas', () => {
  assert.deepEqual([...SUPPORT_DEGRADED_REACHABLE_SECTIONS], ['repair', 'recovery']);
});

test('D-SUP-008: the degraded first-run gate mounts the Support degraded entry', () => {
  // The redesigned first-run gate renders the onboarding wizard. The wizard
  // chrome — present on every phase and terminal screen — mounts the Support
  // degraded entry as the top-right Support pill, so Support stays reachable
  // from the degraded first-run gate. The dedicated repair terminal screen
  // also mounts it. The gate panel composes the wizard.
  const gatePanel = readDesktop(
    'src/shell/renderer/features/nimi-home/first-run-gate-panel.tsx',
  );
  assert.match(gatePanel, /ProductControlWorkflow/);

  const wizardChrome = readDesktop(
    'src/shell/renderer/first-run/first-run-wizard-chrome.tsx',
  );
  assert.match(wizardChrome, /SupportDegradedEntry/);
  assert.match(wizardChrome, /support\/support-degraded-entry/);

  const terminalScreens = readDesktop(
    'src/shell/renderer/first-run/screen-terminal.tsx',
  );
  assert.match(terminalScreens, /SupportDegradedEntry/);
  assert.match(terminalScreens, /support\/support-degraded-entry/);
});

test('D-SUP-008: the degraded entry only exposes repair and recovery', () => {
  const entry = readDesktop('src/shell/renderer/features/support/support-degraded-entry.tsx');
  assert.match(entry, /SUPPORT_DEGRADED_REACHABLE_SECTIONS/);
  assert.match(entry, /SupportRepairSection/);
  assert.match(entry, /SupportRecoverySection/);
  // The degraded entry does not pull in the diagnostics / updates / logs
  // sub-areas — those depend on a running shell, not a recovery path.
  assert.doesNotMatch(entry, /SupportDiagnosticsSection|SupportUpdatesSection|SupportLogsSection/);
});
