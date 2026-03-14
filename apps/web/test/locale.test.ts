import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LANDING_LOCALE_STORAGE_KEY,
  normalizeLocale,
  persistLocale,
  resolveInitialLocale,
} from '../src/landing/i18n/locale.js';

function createMemoryStorage(initial?: Record<string, string>) {
  const state = new Map<string, string>(Object.entries(initial || {}));
  return {
    getItem(key: string) {
      return state.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      state.set(key, value);
    },
  };
}

test('resolveInitialLocale prefers storage value', () => {
  const storage = createMemoryStorage({ [LANDING_LOCALE_STORAGE_KEY]: 'zh' });
  assert.equal(resolveInitialLocale({ storage, navigatorLanguage: 'en-US' }), 'zh');
});

test('resolveInitialLocale falls back to navigator language', () => {
  assert.equal(resolveInitialLocale({ navigatorLanguage: 'zh-CN' }), 'zh');
  assert.equal(resolveInitialLocale({ navigatorLanguage: 'en-US' }), 'en');
});

test('resolveInitialLocale uses default locale when navigator is unavailable', () => {
  assert.equal(resolveInitialLocale({ navigatorLanguage: '', defaultLocale: 'zh' }), 'zh');
});

test('persistLocale writes storage key and normalizeLocale trims values', () => {
  const storage = createMemoryStorage();
  persistLocale('zh', storage);
  assert.equal(storage.getItem(LANDING_LOCALE_STORAGE_KEY), 'zh');
  assert.equal(normalizeLocale(' EN '), 'en');
  assert.equal(normalizeLocale('unknown'), null);
});
