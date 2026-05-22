import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  APPEARANCE_THEMES,
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_DOWNLOAD_PREFERENCES,
  DevicePreferenceProjectionError,
  SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
  SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY,
  appearanceEqual,
  downloadEqual,
  loadAppearancePreferences,
  loadDownloadPreferences,
  persistAppearancePreferences,
  persistDownloadPreferences,
  type AppearancePreferences,
  type DownloadPreferences,
} from '../src/shell/renderer/features/settings/settings-device-preferences.js';

/**
 * T10.3 — Settings surface completion.
 *
 * The Appearance and Downloads sections are device-scoped preference surfaces.
 * They persist through a single typed localStorage projection per family. These
 * tests assert the closed loop: each section persists through the typed path,
 * resolves an absent projection to defaults, and fail-closes on a corrupt
 * projection instead of silently substituting defaults. The wiring and
 * primary-nav regression guards keep Settings a secondary surface.
 */

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

/**
 * Minimal in-memory localStorage so the projection helpers exercise their real
 * code path under `tsx --test` (which has no DOM storage). A `corrupt` seed
 * pre-loads a raw value to simulate a damaged projection blob.
 */
function installMemoryLocalStorage(seed: Record<string, string> = {}): void {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
}

function clearMemoryLocalStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

/* ------------------------------------------------------------------ */
/*  Appearance — typed projection                                     */
/* ------------------------------------------------------------------ */

test('appearance projection resolves an absent key to defaults (valid first-run)', () => {
  installMemoryLocalStorage();
  try {
    const loaded = loadAppearancePreferences();
    assert.deepEqual(loaded, DEFAULT_APPEARANCE_PREFERENCES);
  } finally {
    clearMemoryLocalStorage();
  }
});

test('appearance preferences persist and reload through the typed path', () => {
  installMemoryLocalStorage();
  try {
    const next: AppearancePreferences = {
      theme: 'dark',
      reduceMotion: true,
      highContrast: false,
      largerText: true,
    };
    persistAppearancePreferences(next);
    const reloaded = loadAppearancePreferences();
    assert.ok(appearanceEqual(reloaded, next), 'reloaded appearance must equal persisted value');
  } finally {
    clearMemoryLocalStorage();
  }
});

test('appearance projection fail-closes on a corrupt (non-JSON) projection', () => {
  installMemoryLocalStorage({
    [SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY]: '{not-json',
  });
  try {
    assert.throws(
      () => loadAppearancePreferences(),
      (error: unknown) => error instanceof DevicePreferenceProjectionError,
      'a corrupt appearance projection must raise a typed fail-closed error',
    );
  } finally {
    clearMemoryLocalStorage();
  }
});

test('appearance projection fail-closes on a present non-object projection', () => {
  installMemoryLocalStorage({
    [SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY]: '"a string, not an object"',
  });
  try {
    assert.throws(
      () => loadAppearancePreferences(),
      (error: unknown) => error instanceof DevicePreferenceProjectionError,
    );
  } finally {
    clearMemoryLocalStorage();
  }
});

test('appearance projection fail-closes when localStorage is unavailable', () => {
  clearMemoryLocalStorage();
  assert.throws(
    () => loadAppearancePreferences(),
    (error: unknown) => error instanceof DevicePreferenceProjectionError,
    'a missing storage backend must fail-close, not return defaults',
  );
});

/* ------------------------------------------------------------------ */
/*  Downloads — typed projection                                      */
/* ------------------------------------------------------------------ */

test('download projection resolves an absent key to defaults (valid first-run)', () => {
  installMemoryLocalStorage();
  try {
    const loaded = loadDownloadPreferences();
    assert.deepEqual(loaded, DEFAULT_DOWNLOAD_PREFERENCES);
  } finally {
    clearMemoryLocalStorage();
  }
});

test('download preferences persist and reload through the typed path', () => {
  installMemoryLocalStorage();
  try {
    const next: DownloadPreferences = {
      downloadLocation: '/tmp/nimi-downloads',
      askEachTime: true,
      autoOpenOnComplete: true,
    };
    persistDownloadPreferences(next);
    const reloaded = loadDownloadPreferences();
    assert.ok(downloadEqual(reloaded, next), 'reloaded downloads must equal persisted value');
  } finally {
    clearMemoryLocalStorage();
  }
});

test('download projection fail-closes on a corrupt (non-JSON) projection', () => {
  installMemoryLocalStorage({
    [SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY]: 'not-json-at-all',
  });
  try {
    assert.throws(
      () => loadDownloadPreferences(),
      (error: unknown) => error instanceof DevicePreferenceProjectionError,
      'a corrupt download projection must raise a typed fail-closed error',
    );
  } finally {
    clearMemoryLocalStorage();
  }
});

/* ------------------------------------------------------------------ */
/*  Settings wiring — Appearance / Downloads / Data                   */
/* ------------------------------------------------------------------ */

test('settings page router renders the Appearance and Downloads sections', () => {
  const pagesSource = readDesktopFile('src/shell/renderer/features/settings/settings-pages.tsx');

  assert.match(pagesSource, /import\s+\{\s*AppearancePage\s*\}\s+from\s+'\.\/settings-appearance-page\.js'/);
  assert.match(pagesSource, /import\s+\{\s*DownloadsPage\s*\}\s+from\s+'\.\/settings-downloads-page\.js'/);
  assert.match(pagesSource, /case\s+'appearance':\s+return\s+<AppearancePage\s+\/>/);
  assert.match(pagesSource, /case\s+'downloads':\s+return\s+<DownloadsPage\s+\/>/);
});

test('settings menu lists Appearance and Downloads with i18n keys', () => {
  const assetsSource = readDesktopFile('src/shell/renderer/features/settings/settings-assets.tsx');
  const panelSource = readDesktopFile('src/shell/renderer/features/settings/settings-panel-body.tsx');

  assert.match(assetsSource, /id:\s*'appearance'/);
  assert.match(assetsSource, /id:\s*'downloads'/);
  assert.match(panelSource, /appearance:\s*'Settings\.menuAppearance'/);
  assert.match(panelSource, /downloads:\s*'Settings\.menuDownloads'/);
});

test('Appearance and Downloads locale namespaces are registered en/zh', () => {
  for (const locale of ['en', 'zh']) {
    const indexSource = readDesktopFile(`src/shell/renderer/locales/${locale}/index.ts`);
    assert.match(indexSource, /from '\.\/59-Appearance\.json'/, `${locale} must import 59-Appearance.json`);
    assert.match(indexSource, /from '\.\/60-Downloads\.json'/, `${locale} must import 60-Downloads.json`);
    assert.match(indexSource, /"Appearance":/, `${locale} must register the Appearance namespace`);
    assert.match(indexSource, /"Downloads":/, `${locale} must register the Downloads namespace`);
  }
});

test('appearance theme options are exactly system/light/dark', () => {
  assert.deepEqual([...APPEARANCE_THEMES], ['system', 'light', 'dark']);
});

/* ------------------------------------------------------------------ */
/*  Secondary-surface / primary-nav regression guard                  */
/* ------------------------------------------------------------------ */

test('Settings stays a secondary surface and primary nav stays 5 core items', () => {
  const appTabsSource = readFileSync(
    path.resolve(desktopDir, '../../.nimi/spec/desktop/kernel/tables/app-tabs.yaml'),
    'utf8',
  );
  const coreMatches = appTabsSource.match(/nav_group:\s*core/g) ?? [];
  assert.equal(coreMatches.length, 5, 'primary (core) nav must remain exactly 5 items');

  const settingsBlock = appTabsSource.slice(appTabsSource.indexOf('- id: settings'));
  assert.match(
    settingsBlock.slice(0, 120),
    /nav_group:\s*secondary/,
    'settings must remain a secondary surface, not promoted to core nav',
  );
});
