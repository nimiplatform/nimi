/**
 * T10.5 — Developer Tools surface + Developer Mode gating acceptance
 * (`D-DEV-001..007`).
 *
 * Acceptance coverage for `.nimi/spec/desktop/kernel/devtools-contract.md`:
 *   - D-DEV-001: Developer Tools is a `nav_group: developer` surface gated by
 *     `enableDeveloperTools`; it is NOT in the ordinary primary nav.
 *   - D-DEV-002: the discoverable Developer Mode toggle lives in Settings; it
 *     is not reachable only via env vars / launch params.
 *   - D-DEV-003: the surface composition (mod sources, Tester reference, diagnostics)
 *     and the superseded orphan `DeveloperPage`.
 *   - D-DEV-004: mod UI is reachable only behind Developer Mode; `enableModUi`
 *     defaults `false`.
 *   - D-DEV-005: Desktop keeps only the standalone `nimi.tester` launch
 *     reference; the tester product surface is app-tools-owned.
 *   - D-DEV-006: `nimi.tester` is referenced via the admitted registry row.
 *   - D-DEV-007: developer surfaces default to invisible / unreachable.
 *
 * The ordinary primary nav must stay unchanged — this file re-guards
 * that floor too.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  DEVELOPER_TOOLS_SECTION_IDS,
  resolveDeveloperToolsSection,
  isDeveloperToolsSectionId,
} from '../src/shell/renderer/features/developer/developer-tools-sections.js';
import {
  resolveNimiTesterRegistryReference,
  isNimiTesterDeveloperVisible,
  NIMI_TESTER_APP_ID,
} from '../src/shell/renderer/features/developer/nimi-tester-registry.js';
import { readDesktopLocale } from './helpers/read-desktop-locale.js';

const desktopDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopDir, '../..');

function readDesktop(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function readRepo(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// D-DEV-001 — Developer Tools As Gated Developer Surface
// ---------------------------------------------------------------------------

test('D-DEV-001: app-tabs.yaml registers developer-tools as nav_group developer', () => {
  const appTabs = readRepo('.nimi/spec/desktop/kernel/tables/app-tabs.yaml');
  const entry = appTabs.slice(appTabs.indexOf('  - id: developer-tools'));
  assert.match(entry, /nav_group:\s*developer/);
  assert.match(entry, /gated_by:\s*enableDeveloperTools/);
  assert.match(entry, /source_rule:\s*D-DEV-001/);
});

test('D-DEV-001: AppTab type includes developer-tools', () => {
  const storeTypes = readDesktop('src/shell/renderer/app-shell/providers/store-types.ts');
  assert.match(storeTypes, /\bAppTab\b[\s\S]*?\|\s*'developer-tools'/);
});

test('D-DEV-001: developer-tools is NOT in the ordinary core nav', () => {
  const navConfig = readDesktop('src/shell/renderer/app-shell/layouts/navigation-config.tsx');
  const coreNavBlock = navConfig.slice(
    navConfig.indexOf('BASE_CORE_NAV_ITEMS'),
    navConfig.indexOf('export function getQuickNavItems'),
  );
  const coreIds = [...coreNavBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(coreIds, ['home', 'chat', 'explore', 'apps', 'runtime']);
  assert.equal(coreIds.includes('developer-tools'), false);
});

test('D-DEV-001: the Developer Tools panel mounts only behind Developer Mode', () => {
  const layoutView = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
  assert.match(layoutView, /activeTab === 'developer-tools' && developerModeEnabled/);
  assert.match(layoutView, /<DeveloperToolsPanel \/>/);
  assert.match(layoutView, /features\/developer\/developer-tools-panel/);
});

// ---------------------------------------------------------------------------
// D-DEV-002 — Discoverable Developer Mode Toggle
// ---------------------------------------------------------------------------

test('D-DEV-002: the discoverable Developer Mode toggle is mounted in Settings', () => {
  // The canonical discoverable location is Settings. The Performance settings
  // page mounts the dedicated DeveloperModeToggle component.
  const performancePage = readDesktop('src/shell/renderer/features/settings/settings-performance-page.tsx');
  assert.match(performancePage, /<DeveloperModeToggle \/>/);
  assert.match(performancePage, /features\/developer\/developer-mode-toggle/);
});

test('D-DEV-002: the toggle reads + writes the canonical performance-preferences store', () => {
  const toggle = readDesktop('src/shell/renderer/features/developer/developer-mode-toggle.tsx');
  assert.match(toggle, /persistStoredPerformancePreferences/);
  assert.match(toggle, /developerMode/);
  // It surfaces the current state — not just an enable/disable affordance.
  assert.match(toggle, /developer-mode-status/);
});

test('D-DEV-002: Developer Mode is not reachable only via env vars / launch params', () => {
  // The Developer Mode gate is the persisted `developerMode` preference, set
  // by the discoverable toggle. The gate must NOT be the env-only opt-in.
  const developerMode = readDesktop('src/shell/renderer/features/developer/developer-mode.ts');
  assert.match(developerMode, /loadStoredPerformancePreferences/);
  assert.doesNotMatch(developerMode, /readBundledEnv|VITE_NIMI/);
});

test('D-DEV-002: Developer Mode defaults to off', () => {
  const storage = readDesktop('src/shell/renderer/features/settings/settings-storage.ts');
  assert.match(storage, /developerMode:\s*false/);
});

// ---------------------------------------------------------------------------
// D-DEV-003 — DevTools Surface Composition
// ---------------------------------------------------------------------------

test('D-DEV-003: the surface hosts exactly the three contract sub-areas', () => {
  assert.deepEqual(
    [...DEVELOPER_TOOLS_SECTION_IDS],
    ['mod-sources', 'tester', 'diagnostics'],
  );
});

test('D-DEV-003: the panel dispatches every sub-area', () => {
  const panel = readDesktop('src/shell/renderer/features/developer/developer-tools-panel.tsx');
  for (const section of DEVELOPER_TOOLS_SECTION_IDS) {
    assert.match(panel, new RegExp(`case '${section}':`));
  }
});

test('D-DEV-003: section id resolution rejects unknown sub-areas', () => {
  assert.equal(resolveDeveloperToolsSection('tester'), 'tester');
  assert.equal(resolveDeveloperToolsSection('nonexistent'), 'mod-sources');
  assert.equal(resolveDeveloperToolsSection(null), 'mod-sources');
  assert.equal(isDeveloperToolsSectionId('diagnostics'), true);
  assert.equal(isDeveloperToolsSectionId('settings'), false);
});

test('D-DEV-003: the orphan DeveloperPage is superseded — no orphan body left', () => {
  // The previously orphaned mod-source management body now lives in the
  // developer feature as the `mod-sources` sub-area.
  const section = readDesktop('src/shell/renderer/features/developer/developer-mod-sources-section.tsx');
  assert.match(section, /export function DeveloperModSourcesSection/);
  assert.match(section, /reloadAllRuntimeMods/);
  // settings-developer-page.tsx retains only the alias — not a duplicated body.
  const aliasFile = readDesktop('src/shell/renderer/features/settings/settings-developer-page.tsx');
  assert.match(aliasFile, /DeveloperModSourcesSection as DeveloperPage/);
  assert.doesNotMatch(aliasFile, /reloadAllRuntimeMods/);
});

// ---------------------------------------------------------------------------
// D-DEV-004 — Mod UI Behind Developer Mode
// ---------------------------------------------------------------------------

test('D-DEV-004: feature-flags.yaml defaults enableModUi to false on desktop', () => {
  const flags = readRepo('.nimi/spec/desktop/kernel/tables/feature-flags.yaml');
  const entry = flags.slice(flags.indexOf('  - flag: enableModUi'));
  const block = entry.slice(0, entry.indexOf('  - flag: ', 1));
  assert.match(block, /default_desktop:\s*false/);
  assert.match(block, /source_rule:\s*D-DEV-004/);
});

test('D-DEV-004: the shell-mode flag struct defaults enableModUi off', () => {
  const shellMode = readFileSync(
    path.join(repoRoot, 'kit/core/src/shell-mode.ts'),
    'utf8',
  );
  // enableModUi is only ever true behind an explicit developer opt-in — never
  // a default-true desktop flag.
  assert.match(shellMode, /enableModUi:\s*isDesktop && developerModUiOptIn/);
});

test('D-DEV-004: the mods panel is gated by Developer-Mode-derived reachability', () => {
  const layoutView = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
  // The renderer derives `modUiReachable` from the build flag AND admitted
  // Developer Mode, and the mods panel + route-extension slot host both use it.
  assert.match(layoutView, /modUiReachable\s*=\s*flags\.enableModUi && isModUiEnabled\(\) && developerModeEnabled/);
  assert.match(layoutView, /activeTab === 'mods' && modUiReachable/);
  assert.match(layoutView, /\{modUiReachable \? \(/);
});

test('D-DEV-004: the layout redirects away from mod surfaces when Developer Mode is off', () => {
  const mainLayout = readDesktop('src/shell/renderer/app-shell/layouts/main-layout.tsx');
  assert.match(mainLayout, /!modUiReachable && \(activeTab === 'mods' \|\| activeTab\.startsWith\('mod:'\)\)/);
});

// ---------------------------------------------------------------------------
// D-DEV-005 — Standalone Tester Reference Gated Behind Developer Mode
// ---------------------------------------------------------------------------

test('D-DEV-005: the standalone Tester reference is reachable only inside Developer Tools', () => {
  const testerSection = readDesktop('src/shell/renderer/features/developer/developer-tester-section.tsx');
  assert.match(testerSection, /desktopAppLifecycleBridge\.open/);
  assert.match(testerSection, /resolveNimiTesterRegistryReference/);
  assert.doesNotMatch(testerSection, /features\/tester\/tester-page/);
  assert.doesNotMatch(testerSection, /TesterPage/);
  // The Developer Tools panel dispatches the Tester sub-area.
  const panel = readDesktop('src/shell/renderer/features/developer/developer-tools-panel.tsx');
  assert.match(panel, /<DeveloperTesterSection \/>/);
});

test('D-DEV-005: the Tester product surface is not embedded in Desktop source', () => {
  assert.equal(
    existsSync(path.join(desktopDir, 'src/shell/renderer/features/tester')),
    false,
  );
  const routes = readDesktop('src/shell/renderer/app-shell/routes/app-routes.tsx');
  assert.doesNotMatch(routes, /world-tour-viewer|WorldTourViewerRoute|features\/tester/);
  const bootstrap = readDesktop('src-tauri/src/main_parts/app_bootstrap.rs');
  assert.doesNotMatch(
    bootstrap,
    /tester_(image|run|fixture)|world_tour|resolve_world_tour_fixture|claim_world_tour_viewer_launch|open_world_tour_window/,
  );
});

// ---------------------------------------------------------------------------
// D-DEV-006 — `nimi.tester` Registry Registration Relationship
// ---------------------------------------------------------------------------

test('D-DEV-006: nimi.tester resolves from the admitted platform registry row', () => {
  const reference = resolveNimiTesterRegistryReference();
  assert.ok(reference, 'nimi.tester must resolve from the admitted registry projection');
  assert.equal(reference?.appId, NIMI_TESTER_APP_ID);
  assert.equal(reference?.admissionStatus, 'admitted');
  assert.equal(reference?.ordinaryVisibility, 'developer-only');
  assert.equal(reference?.releaseDescriptorRef, 'nimi.tester.bundled-with-nimi');
  assert.equal(isNimiTesterDeveloperVisible(reference), true);
});

test('D-DEV-006: a non-admitted / missing row fails closed', () => {
  assert.equal(isNimiTesterDeveloperVisible(null), false);
  assert.equal(
    isNimiTesterDeveloperVisible({
      appId: NIMI_TESTER_APP_ID,
      displayName: 'Tester',
      ordinaryVisibility: 'ordinary-visible',
      releaseDescriptorRef: 'nimi.tester.bundled-with-nimi',
      admissionStatus: 'admitted',
      sourceRule: 'P-NAPP-016',
    }),
    false,
    'ordinary-visible visibility must not surface the standalone Tester reference',
  );
});

test('D-DEV-006: the registry row — not the source folder — is the admission truth', () => {
  const registry = readDesktop('src/shell/renderer/features/developer/nimi-tester-registry.ts');
  assert.match(registry, /loadPlatformNimiAppRegistryRows/);
  // The reference consumes the typed registry projection; it does not treat a
  // Tauri command, source folder, or fixture cache as admission truth.
  const testerSection = readDesktop('src/shell/renderer/features/developer/developer-tester-section.tsx');
  assert.match(testerSection, /resolveNimiTesterRegistryReference/);
  assert.match(testerSection, /isNimiTesterDeveloperVisible/);
});

// ---------------------------------------------------------------------------
// D-DEV-007 — Developer Surface Visibility Default
// ---------------------------------------------------------------------------

test('D-DEV-007: the Developer Tools account-menu entry is invisible by default', () => {
  const settingsMenu = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx');
  // The developer-tools submenu item is filtered out unless Developer Mode is on.
  assert.match(settingsMenu, /item\.id !== 'developer-tools' \|\| props\.developerModeEnabled/);
});

test('D-DEV-007: navigation to developer-tools is guarded by Developer Mode', () => {
  const layoutView = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
  assert.match(layoutView, /itemId === 'developer-tools'[\s\S]*?if \(developerModeEnabled\)/);
});

test('D-DEV-007: the layout redirects away from developer-tools when Developer Mode is off', () => {
  const mainLayout = readDesktop('src/shell/renderer/app-shell/layouts/main-layout.tsx');
  assert.match(mainLayout, /!developerModeEnabled && activeTab === 'developer-tools'/);
});

// ---------------------------------------------------------------------------
// Ordinary primary nav floor — regression guard
// ---------------------------------------------------------------------------

test('D-DEV-001: getCoreNavItems still returns exactly the ordinary items', () => {
  const navConfig = readDesktop('src/shell/renderer/app-shell/layouts/navigation-config.tsx');
  const fn = navConfig.slice(
    navConfig.indexOf('export function getCoreNavItems'),
    navConfig.indexOf('export function NavLink'),
  );
  assert.doesNotMatch(fn, /developer-tools/);
  assert.doesNotMatch(fn, /'mods'/);
});

// ---------------------------------------------------------------------------
// Locale coverage
// ---------------------------------------------------------------------------

test('D-DEV: DeveloperTools i18n keys are present in both locales', () => {
  const en = readDesktopLocale('en');
  const zh = readDesktopLocale('zh');
  assert.ok(en.DeveloperTools, 'en must have DeveloperTools namespace');
  assert.ok(zh.DeveloperTools, 'zh must have DeveloperTools namespace');
  const requiredKeys = [
    'surfaceTitle',
    'sectionModSources',
    'sectionTester',
    'sectionDiagnostics',
    'developerModeTitle',
    'developerModeEnable',
    'developerModeDisable',
    'testerUnavailableTitle',
  ];
  for (const key of requiredKeys) {
    assert.ok(key in en.DeveloperTools, `en DeveloperTools must include ${key}`);
    assert.ok(key in zh.DeveloperTools, `zh DeveloperTools must include ${key}`);
  }
});
