import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  SETTINGS_SELECTED_STORAGE_KEY,
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from '../src/shell/renderer/features/settings/settings-storage.js';
import { readDesktopLocale } from './helpers/read-desktop-locale';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktop(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

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

function getValueAtKey(input: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, input);
}

test('account menu does not expose legal documents as user-account actions', () => {
  const menuSource = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx');
  const layoutViewSource = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');

  assert.doesNotMatch(menuSource, /id:\s*'terms-of-service'|id:\s*'privacy-policy'/);
  assert.doesNotMatch(menuSource, /Menu\.termsOfService|Menu\.privacyPolicy/);
  assert.doesNotMatch(layoutViewSource, /itemId === 'terms-of-service'|itemId === 'privacy-policy'/);
});

test('Settings owns a single About & Legal entry that points to the full legal document panels', () => {
  const settingsAssetsSource = readDesktop('src/shell/renderer/features/settings/settings-assets.tsx');
  const settingsPanelSource = readDesktop('src/shell/renderer/features/settings/settings-panel-body.tsx');
  const settingsPagesSource = readDesktop('src/shell/renderer/features/settings/settings-pages.tsx');
  const aboutLegalPageSource = readDesktop('src/shell/renderer/features/settings/settings-about-legal-page.tsx');

  assert.match(settingsAssetsSource, /label:\s*'About & Legal'/);
  assert.match(settingsAssetsSource, /id:\s*'about-legal'/);
  assert.match(settingsPanelSource, /'About & Legal':\s*'Settings\.sectionAboutLegal'/);
  assert.match(settingsPanelSource, /'about-legal':\s*'Settings\.menuAboutLegal'/);
  assert.match(settingsPagesSource, /import\s+\{\s*AboutLegalPage\s*\}\s+from\s+'\.\/settings-about-legal-page\.js'/);
  assert.match(settingsPagesSource, /case\s+'about-legal':\s+return\s+<AboutLegalPage\s+\/>/);
  assert.match(aboutLegalPageSource, /setActiveTab\('terms-of-service'\)/);
  assert.match(aboutLegalPageSource, /setActiveTab\('privacy-policy'\)/);
  assert.doesNotMatch(aboutLegalPageSource, /rounded-2xl border border-gray-200 bg-white p-6 shadow-sm/);
  assert.doesNotMatch(aboutLegalPageSource, /text-xl font-semibold text-gray-900/);
  assert.doesNotMatch(aboutLegalPageSource, /aboutLegalSectionDescription/);
});

test('settings selected storage admits about-legal and rejects stale direct legal selections', () => {
  installMemoryLocalStorage({
    [SETTINGS_SELECTED_STORAGE_KEY]: 'about-legal',
  });
  try {
    assert.equal(loadStoredSettingsSelected('profile'), 'about-legal');

    persistStoredSettingsSelected('privacy-policy');
    assert.equal(loadStoredSettingsSelected('profile'), 'profile');

    persistStoredSettingsSelected('terms-of-service');
    assert.equal(loadStoredSettingsSelected('profile'), 'profile');
  } finally {
    clearMemoryLocalStorage();
  }
});

test('About & Legal settings copy exists in desktop locales', () => {
  for (const locale of ['en', 'zh'] as const) {
    const messages = readDesktopLocale(locale);
    for (const key of [
      'Settings.sectionAboutLegal',
      'Settings.menuAboutLegal',
      'Settings.aboutLegalTitle',
      'Settings.aboutLegalDescription',
      'Settings.aboutLegalTermsDescription',
      'Settings.aboutLegalPrivacyDescription',
      'Legal.terms.title',
      'Legal.privacy.title',
    ]) {
      const value = getValueAtKey(messages, key);
      assert.equal(typeof value, 'string', `${locale} locale is missing ${key}`);
      assert.match(String(value || ''), /\S/, `${locale} locale has empty ${key}`);
    }
  }
});
