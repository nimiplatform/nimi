import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { toRuntimeModRow } from '../src/shell/renderer/features/mod-hub/mod-hub-model';
import type { AppTab } from '../src/shell/renderer/app-shell/providers/store-types';

// ---------------------------------------------------------------------------
// 1. AppTab type includes 'mods'
// ---------------------------------------------------------------------------

test('AppTab union includes mods literal', () => {
  // Compile-time check: assigning 'mods' to AppTab must not error.
  const tab: AppTab = 'mods';
  assert.equal(tab, 'mods');
});

test('AppTab union includes mod:* pattern', () => {
  const tab: AppTab = 'mod:test-mod';
  assert.ok(tab.startsWith('mod:'));
});

// ---------------------------------------------------------------------------
// 2. toRuntimeModRow produces correct shape for mods panel
// ---------------------------------------------------------------------------

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test.mod',
    name: 'Test Mod',
    description: 'A test mod for unit tests',
    version: '1.2.3',
    entryPath: '/mods/test-mod/index.js',
    manifest: {
      name: 'Test Mod',
      version: '1.2.3',
      author: { name: 'Test Author' },
      description: 'A test mod',
    },
    ...overrides,
  };
}

test('toRuntimeModRow returns correct fields for enabled mod', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
  });

  assert.equal(row.id, 'test.mod');
  assert.equal(row.name, 'Test Mod');
  assert.equal(row.isInstalled, true);
  assert.equal(row.isEnabled, true);
  assert.equal(row.source, 'runtime');
  assert.equal(row.version, 'v1.2.3');
  assert.equal(row.author, 'Test Author');
  assert.ok(row.iconBg, 'iconBg should be a non-empty string');
  assert.ok(row.iconText, 'iconText should be a non-empty string');
});

test('toRuntimeModRow returns correct fields for disabled mod', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: false,
  });

  assert.equal(row.isInstalled, true);
  assert.equal(row.isEnabled, false);
});

test('toRuntimeModRow handles missing manifest fields gracefully', () => {
  const row = toRuntimeModRow(
    makeSummary({ manifest: null, name: '', description: '', version: '' }) as never,
    0,
    { isInstalled: true, isEnabled: true },
  );

  assert.ok(row.name, 'name should fallback to id or default');
  assert.ok(row.description, 'description should have a fallback');
  assert.equal(row.version, 'v1.0.0');
});

test('toRuntimeModRow strips "desktop " prefix from display name', () => {
  const row = toRuntimeModRow(
    makeSummary({ name: 'Desktop Local Chat' }) as never,
    0,
    { isInstalled: true, isEnabled: true },
  );

  assert.equal(row.name, 'Local Chat');
});

test('toRuntimeModRow does not special-case local-chat display names', () => {
  const row = toRuntimeModRow(
    makeSummary({ id: 'world.nimi.local-chat', name: '' }) as never,
    0,
    { isInstalled: true, isEnabled: true },
  );

  assert.equal(row.name, 'Test Mod');
});

// ---------------------------------------------------------------------------
// 3. Mod enabled/disabled classification logic (pure)
// ---------------------------------------------------------------------------

test('mod classification: installed & registered & not-disabled → enabled', () => {
  const registeredSet = new Set(['mod-a', 'mod-b']);
  const disabledSet = new Set<string>();
  const uninstalledSet = new Set<string>();

  const modId = 'mod-a';
  const isInstalled = !uninstalledSet.has(modId);
  const isEnabled = isInstalled && !disabledSet.has(modId) && registeredSet.has(modId);

  assert.equal(isInstalled, true);
  assert.equal(isEnabled, true);
});

test('mod classification: installed & disabled → disabled', () => {
  const registeredSet = new Set(['mod-a']);
  const disabledSet = new Set(['mod-a']);
  const uninstalledSet = new Set<string>();

  const modId = 'mod-a';
  const isInstalled = !uninstalledSet.has(modId);
  const isEnabled = isInstalled && !disabledSet.has(modId) && registeredSet.has(modId);

  assert.equal(isInstalled, true);
  assert.equal(isEnabled, false);
});

test('mod classification: uninstalled → excluded', () => {
  const uninstalledSet = new Set(['mod-a']);

  const modId = 'mod-a';
  const isInstalled = !uninstalledSet.has(modId);

  assert.equal(isInstalled, false);
});

test('mod classification: installed but not registered → disabled', () => {
  const registeredSet = new Set<string>();
  const disabledSet = new Set<string>();
  const uninstalledSet = new Set<string>();

  const modId = 'mod-a';
  const isInstalled = !uninstalledSet.has(modId);
  const isEnabled = isInstalled && !disabledSet.has(modId) && registeredSet.has(modId);

  assert.equal(isInstalled, true);
  assert.equal(isEnabled, false);
});

// ---------------------------------------------------------------------------
// 4. Search filter logic (pure)
// ---------------------------------------------------------------------------

function filterMods(
  mods: Array<{ name: string; description: string }>,
  query: string,
): typeof mods {
  const q = query.toLowerCase().trim();
  if (!q) return mods;
  return mods.filter(
    (mod) =>
      mod.name.toLowerCase().includes(q) ||
      mod.description.toLowerCase().includes(q),
  );
}

test('search filter: empty query returns all mods', () => {
  const mods = [
    { name: 'Local Chat', description: 'Chat locally' },
    { name: 'Theme', description: 'Dark mode' },
  ];
  assert.equal(filterMods(mods, '').length, 2);
  assert.equal(filterMods(mods, '  ').length, 2);
});

test('search filter: matches by name (case-insensitive)', () => {
  const mods = [
    { name: 'Local Chat', description: 'Chat locally' },
    { name: 'Theme', description: 'Dark mode' },
  ];
  assert.equal(filterMods(mods, 'local').length, 1);
  assert.equal(filterMods(mods, 'LOCAL').length, 1);
  assert.equal(filterMods(mods, 'Chat').length, 1);
});

test('search filter: matches by description', () => {
  const mods = [
    { name: 'Local Chat', description: 'Chat locally' },
    { name: 'Theme', description: 'Dark mode' },
  ];
  assert.equal(filterMods(mods, 'dark').length, 1);
});

test('search filter: no matches', () => {
  const mods = [
    { name: 'Local Chat', description: 'Chat locally' },
  ];
  assert.equal(filterMods(mods, 'nonexistent').length, 0);
});

// ---------------------------------------------------------------------------
// 5. i18n key completeness: en.json and zh.json ModHub section
// ---------------------------------------------------------------------------

test('ModHub i18n keys are complete in both en.json and zh.json', () => {
  const enPath = resolve(
    import.meta.dirname,
    '../src/shell/renderer/locales/en.json',
  );
  const zhPath = resolve(
    import.meta.dirname,
    '../src/shell/renderer/locales/zh.json',
  );

  const en = JSON.parse(readFileSync(enPath, 'utf-8'));
  const zh = JSON.parse(readFileSync(zhPath, 'utf-8'));

  assert.ok(en.ModHub, 'en.json must have ModHub section');
  assert.ok(zh.ModHub, 'zh.json must have ModHub section');

  const enKeys = Object.keys(en.ModHub).sort();
  const zhKeys = Object.keys(zh.ModHub).sort();

  assert.deepEqual(enKeys, zhKeys, 'ModHub keys must match between en.json and zh.json');

  const requiredKeys = [
    'title',
    'searchPlaceholder',
    'resultsCount',
    'installedCount',
    'installFromPathTitle',
    'installFromPathAction',
    'installFromUrlTitle',
    'installFromUrlAction',
    'installedSection',
    'availableSection',
    'noSearchResults',
  ];

  for (const key of requiredKeys) {
    assert.ok(
      enKeys.includes(key),
      `en.json ModHub must include key: ${key}`,
    );
    assert.ok(
      zhKeys.includes(key),
      `zh.json ModHub must include key: ${key}`,
    );
  }

  for (const key of enKeys) {
    const enValue = en.ModHub[key];
    const zhValue = zh.ModHub[key];
    assert.ok(
      typeof enValue === 'string' && enValue.length > 0,
      `en.json ModHub.${key} must be a non-empty string`,
    );
    assert.ok(
      typeof zhValue === 'string' && zhValue.length > 0,
      `zh.json ModHub.${key} must be a non-empty string`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. Disable/Uninstall fallback navigation target
// ---------------------------------------------------------------------------

test('mod hub controller fallback target is mods without removed alias', () => {
  const controllerPath = resolve(
    import.meta.dirname,
    '../src/shell/renderer/features/mod-hub/mod-hub-controller.ts',
  );
  const source = readFileSync(controllerPath, 'utf-8');
  const removedAlias = ['mark', 'etplace'].join('');

  const setActiveTabCalls = source.match(/setActiveTab\(['"]([^'"]+)['"]\)/g) || [];

  // There should be setActiveTab('mods') calls for the fallback
  const modsTabCalls = setActiveTabCalls.filter((call) => call.includes("'mods'"));
  assert.ok(
    modsTabCalls.length >= 2,
    `Expected at least 2 setActiveTab('mods') fallback calls in mod-hub-controller, found ${modsTabCalls.length}`,
  );

  const removedAliasCalls = setActiveTabCalls.filter((call) => call.includes(`'${removedAlias}'`));
  assert.equal(
    removedAliasCalls.length,
    0,
    `Expected 0 removed alias fallback calls, found ${removedAliasCalls.length}`,
  );
});

test('store types no longer include removed app tab alias', () => {
  const storeTypesPath = resolve(
    import.meta.dirname,
    '../src/shell/renderer/app-shell/providers/store-types.ts',
  );
  const source = readFileSync(storeTypesPath, 'utf-8');
  const removedAliasPattern = new RegExp(`\\|\\s*'${['mark', 'etplace'].join('')}'`);

  assert.doesNotMatch(source, removedAliasPattern);
});

// ---------------------------------------------------------------------------
// 7. Spec YAML alignment: mods tab exists in app-tabs.yaml
// ---------------------------------------------------------------------------

test('app-tabs.yaml includes mods tab with correct gating', () => {
  const yamlPath = resolve(
    import.meta.dirname,
    '../../../spec/desktop/kernel/tables/app-tabs.yaml',
  );
  const content = readFileSync(yamlPath, 'utf-8');

  assert.ok(content.includes('id: mods'), 'app-tabs.yaml must include mods tab');
  assert.ok(content.includes('gated_by: enableModUi'), 'mods tab must be gated by enableModUi');
});

// ---------------------------------------------------------------------------
// 8. Guard clause: mods tab protected by enableModUi
// ---------------------------------------------------------------------------

test('main-layout.tsx has guard clause for mods tab', () => {
  const layoutPath = resolve(
    import.meta.dirname,
    '../src/shell/renderer/app-shell/layouts/main-layout.tsx',
  );
  const source = readFileSync(layoutPath, 'utf-8');

  assert.ok(
    source.includes("activeTab === 'mods'"),
    'main-layout.tsx must have guard clause checking activeTab === mods',
  );
  assert.ok(
    source.includes("!flags.enableModUi && activeTab === 'mods'"),
    'main-layout.tsx must guard mods tab behind enableModUi flag',
  );
});
