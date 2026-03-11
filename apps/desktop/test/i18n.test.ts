import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeLocale,
  formatRelativeLocaleTime,
  initI18n,
} from '../src/shell/renderer/i18n';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as typeof globalThis & { document?: { title: string; documentElement: { lang: string } } }).document = {
    title: '',
    documentElement: { lang: 'en' },
  };
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
