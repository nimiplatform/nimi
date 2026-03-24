import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  changeLocale,
  formatRelativeLocaleTime,
  initI18n,
} from '../src/shell/renderer/i18n';

function installDomGlobals(): () => void {
  const previousLocalStorage = globalThis.localStorage;
  const previousDocument = globalThis.document;
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      length: 0,
      clear: () => {
        store.clear();
      },
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    } as Storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: {
      title: '',
      documentElement: { lang: 'en' } as HTMLElement,
    } as Document,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: previousLocalStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: previousDocument,
      configurable: true,
    });
  };
}

let restoreDomGlobals: () => void = () => {};

test.beforeEach(() => {
  restoreDomGlobals = installDomGlobals();
});

test.afterEach(() => {
  restoreDomGlobals();
});

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

test('auth runtime locale keys exist in both desktop locales', async () => {
  const localePaths = [
    resolve(import.meta.dirname, '../src/shell/renderer/locales/en.json'),
    resolve(import.meta.dirname, '../src/shell/renderer/locales/zh.json'),
  ];
  const requiredKeys = [
    'passwordLoginFailed',
    'requestEmailOtpFailed',
    'verifyEmailOtpFailed',
    'verifyTwoFactorFailed',
    'walletChallengeFailed',
    'walletLoginFailed',
    'oauthLoginFailed',
  ];

  for (const localePath of localePaths) {
    const source = await readFile(localePath, 'utf8');
    const auth = (JSON.parse(source) as { Auth?: Record<string, unknown> }).Auth || {};
    for (const key of requiredKeys) {
      assert.equal(
        typeof auth[key],
        'string',
        `${localePath} is missing Auth.${key}`,
      );
      assert.match(String(auth[key] || ''), /\S/, `${localePath} has empty Auth.${key}`);
    }
  }
});
