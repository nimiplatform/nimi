import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeLocale,
  formatRelativeLocaleTime,
  initI18n,
} from '../src/shell/renderer/i18n';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = {
    length: 0,
    clear: () => {
      store.clear();
    },
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  } as Storage;
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as typeof globalThis & { document?: Document }).document = {
    title: '',
    documentElement: { lang: 'en' } as HTMLElement,
  } as Document;
}

test('changeLocale synchronizes document title and lang', async () => {
  await initI18n();

  await changeLocale('zh');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(document.title, 'Nimi 桌面运行时');

  await changeLocale('en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.title, 'Nimi Desktop Runtime');
});

test('formatRelativeLocaleTime follows current locale', async () => {
  await initI18n();

  const ts = new Date(Date.now() - 5 * 60_000).toISOString();

  await changeLocale('en');
  assert.equal(formatRelativeLocaleTime(ts), '5m ago');

  await changeLocale('zh');
  assert.equal(formatRelativeLocaleTime(ts), '5 分钟前');
});
