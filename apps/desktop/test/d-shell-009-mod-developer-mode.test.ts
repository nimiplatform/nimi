import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDesktopLocale } from './helpers/read-desktop-locale';

// ---------------------------------------------------------------------------
// D-SHELL-009: Mod Developer Mode
// Desktop must provide explicit Developer Mode entry in Settings.
// Developer Mode manages: dev source directories, auto-reload toggle, diagnostics.
// No launch parameter dependency for main development path.
// ---------------------------------------------------------------------------

// 1. Developer mode state type has required fields
test('D-SHELL-009: RuntimeModDeveloperModeState has enabled and autoReloadEnabled fields', () => {
  const typesSource = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/runtime-types.ts'),
    'utf8',
  );

  assert.match(
    typesSource,
    /RuntimeModDeveloperModeState\s*=\s*\{/,
    'RuntimeModDeveloperModeState type must exist',
  );
  assert.match(typesSource, /enabled:\s*boolean/, 'Must have enabled field');
  assert.match(typesSource, /autoReloadEnabled:\s*boolean/, 'Must have autoReloadEnabled field');
});

// 2. Developer page exists and provides dedicated Developer Mode UI
test('D-SHELL-009: DeveloperPage component is exported from settings', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /export function DeveloperPage/, 'DeveloperPage must be exported');
});

// 3. Developer page provides enable/disable developer mode toggle
test('D-SHELL-009: developer page has developer mode toggle buttons', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /enableDeveloperMode/, 'Must reference enableDeveloperMode i18n key');
  assert.match(source, /disableDeveloperMode/, 'Must reference disableDeveloperMode i18n key');
});

// 4. Developer page provides auto-reload toggle
test('D-SHELL-009: developer page has auto-reload toggle buttons', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /enableAutoReload/, 'Must reference enableAutoReload i18n key');
  assert.match(source, /disableAutoReload/, 'Must reference disableAutoReload i18n key');
});

// 5. Developer page provides reload all button
test('D-SHELL-009: developer page has reload all button', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /reloadAll/, 'Must have reload all action');
  assert.match(source, /reloadAllRuntimeMods/, 'Must invoke reloadAllRuntimeMods bridge command');
});

// 6. Developer mode state is tracked in app store
test('D-SHELL-009: app store tracks runtimeModDeveloperMode state', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(
    source,
    /useAppStore\(.*runtimeModDeveloperMode/s,
    'DeveloperPage must read runtimeModDeveloperMode from app store',
  );
});

// 7. Developer page shows source summary (total, dev, enabled counts)
test('D-SHELL-009: developer page shows source summary counts', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /sourceSummary/, 'Must compute source summary');
  assert.match(source, /total:\s*runtimeModSources\.length/, 'Must show total count');
  assert.match(source, /sourceType\s*===\s*'dev'/, 'Must filter dev sources');
});

// 8. DeveloperSettings i18n keys exist in both locales
test('D-SHELL-009: DeveloperSettings i18n keys are present in en.json and zh.json', () => {
  const en = readDesktopLocale('en');
  const zh = readDesktopLocale('zh');

  assert.ok(en.DeveloperSettings, 'en.json must have DeveloperSettings section');
  assert.ok(zh.DeveloperSettings, 'zh.json must have DeveloperSettings section');

  const requiredKeys = [
    'pageTitle',
    'modeTitle',
    'enableDeveloperMode',
    'disableDeveloperMode',
    'enableAutoReload',
    'disableAutoReload',
    'reloadAll',
    'addSourceTitle',
    'dataDirTitle',
    'registeredSourcesTitle',
    'diagnosticsTitle',
  ];

  for (const key of requiredKeys) {
    assert.ok(
      key in en.DeveloperSettings,
      `en.json DeveloperSettings must include key: ${key}`,
    );
    assert.ok(
      key in zh.DeveloperSettings,
      `zh.json DeveloperSettings must include key: ${key}`,
    );
  }
});
