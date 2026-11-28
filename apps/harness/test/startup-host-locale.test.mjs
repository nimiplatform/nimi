import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  I18nProvider,
  LOCALE_STORAGE_KEY,
  applyStartupHostLocaleOnce,
  detectInitialLocale,
  useI18n,
} from '../src/i18n.ts';

function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  let setCalls = 0;
  return {
    get setCalls() {
      return setCalls;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      setCalls += 1;
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function withBrowserEnv({ navigatorLanguage, storedLocale, electronInvoke }, fn) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousElectron = Object.getOwnPropertyDescriptor(globalThis, '__NIMI_ELECTRON_RUNTIME__');

  const storage = createMemoryStorage(
    storedLocale === undefined ? {} : { [LOCALE_STORAGE_KEY]: storedLocale },
  );

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { localStorage: storage },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { language: navigatorLanguage },
  });
  if (electronInvoke) {
    Object.defineProperty(globalThis, '__NIMI_ELECTRON_RUNTIME__', {
      configurable: true,
      writable: true,
      value: { invoke: electronInvoke },
    });
  } else {
    delete globalThis.__NIMI_ELECTRON_RUNTIME__;
  }

  const restore = () => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      delete globalThis.window;
    }
    if (previousNavigator) {
      Object.defineProperty(globalThis, 'navigator', previousNavigator);
    } else {
      delete globalThis.navigator;
    }
    if (previousElectron) {
      Object.defineProperty(globalThis, '__NIMI_ELECTRON_RUNTIME__', previousElectron);
    } else {
      delete globalThis.__NIMI_ELECTRON_RUNTIME__;
    }
  };

  return Promise.resolve()
    .then(() => fn({ storage }))
    .finally(restore);
}

test('W0-01 / FIX-017: EN Home on zh-CN navigator resolves to en once without writing to localStorage', async () => {
  await withBrowserEnv({ navigatorLanguage: 'zh-CN' }, async ({ storage }) => {
    assert.equal(detectInitialLocale(), 'zh');

    let getLocaleCalls = 0;
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      hostLocaleSource: {
        async getLocale() {
          getLocaleCalls += 1;
          return 'en';
        },
      },
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, 'en');
    assert.deepEqual(applied, ['en']);
    assert.equal(getLocaleCalls, 1);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
    assert.equal(storage.setCalls, 0);
  });
});

test('W0-01 / FIX-017: ZH Home on en-US navigator resolves to zh once without writing to localStorage', async () => {
  await withBrowserEnv({ navigatorLanguage: 'en-US' }, async ({ storage }) => {
    assert.equal(detectInitialLocale(), 'en');

    let getLocaleCalls = 0;
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      hostLocaleSource: {
        async getLocale() {
          getLocaleCalls += 1;
          return { locale: 'zh' };
        },
      },
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, 'zh');
    assert.deepEqual(applied, ['zh']);
    assert.equal(getLocaleCalls, 1);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
    assert.equal(storage.setCalls, 0);
  });
});

test('W0-01 / FIX-017: explicit stored override wins over Host locale and skips host IPC read', async () => {
  await withBrowserEnv({ navigatorLanguage: 'en-US', storedLocale: 'zh' }, async ({ storage }) => {
    assert.equal(detectInitialLocale(), 'zh');

    let getLocaleCalls = 0;
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      hostLocaleSource: {
        async getLocale() {
          getLocaleCalls += 1;
          return 'en';
        },
      },
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, null);
    assert.deepEqual(applied, []);
    assert.equal(getLocaleCalls, 0);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), 'zh');
    assert.equal(storage.setCalls, 0);
  });

  await withBrowserEnv({ navigatorLanguage: 'zh-CN', storedLocale: 'en' }, async ({ storage }) => {
    assert.equal(detectInitialLocale(), 'en');

    let getLocaleCalls = 0;
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      hostLocaleSource: {
        async getLocale() {
          getLocaleCalls += 1;
          return 'zh';
        },
      },
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, null);
    assert.deepEqual(applied, []);
    assert.equal(getLocaleCalls, 0);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), 'en');
    assert.equal(storage.setCalls, 0);
  });
});

test('W0-01 / FIX-017: null Host locale falls back cleanly to navigator language and en fallback', async () => {
  await withBrowserEnv({ navigatorLanguage: 'zh-CN' }, async ({ storage }) => {
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      hostLocaleSource: { async getLocale() { return null; } },
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, 'zh');
    assert.deepEqual(applied, ['zh']);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
    assert.equal(storage.setCalls, 0);
  });

  await withBrowserEnv({ navigatorLanguage: 'fr-FR' }, async ({ storage }) => {
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      hostLocaleSource: { async getLocale() { return null; } },
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, 'en');
    assert.deepEqual(applied, ['en']);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
    assert.equal(storage.setCalls, 0);
  });
});

test('W0-01 / FIX-017: default host locale source uses Kit shell-ui.hostLocaleGet bridge and handles non-Electron cleanly', async () => {
  const calls = [];
  await withBrowserEnv({
    navigatorLanguage: 'zh-CN',
    electronInvoke: async (command, payload) => {
      calls.push({ command, payload });
      return { locale: 'en' };
    },
  }, async ({ storage }) => {
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, 'en');
    assert.deepEqual(applied, ['en']);
    assert.deepEqual(calls, [
      { command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.hostLocaleGet'], payload: {} },
    ]);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
  });

  // Outside Electron, getShellHostLocale() returns null and falls back to navigator.
  await withBrowserEnv({ navigatorLanguage: 'zh-CN' }, async ({ storage }) => {
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, 'zh');
    assert.deepEqual(applied, ['zh']);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
  });
});

test('W0-01 / FIX-017: stale/unmounted, manual-switch race, and host read failure never clobber user state', async () => {
  // 1. Unmount / stale cancellation before host promise resolves.
  await withBrowserEnv({ navigatorLanguage: 'zh-CN' }, async ({ storage }) => {
    let resolveHost;
    const hostPromise = new Promise((resolve) => { resolveHost = resolve; });
    let stale = false;
    const applied = [];

    const pending = applyStartupHostLocaleOnce({
      hostLocaleSource: { getLocale: () => hostPromise },
      isStale: () => stale,
      applyLocale: (locale) => applied.push(locale),
    });

    stale = true;
    resolveHost('en');
    const resolved = await pending;

    assert.equal(resolved, null);
    assert.deepEqual(applied, []);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
  });

  // 2. Manual switch writes localStorage before host promise resolves.
  await withBrowserEnv({ navigatorLanguage: 'en-US' }, async ({ storage }) => {
    let resolveHost;
    const hostPromise = new Promise((resolve) => { resolveHost = resolve; });
    const applied = [];

    const pending = applyStartupHostLocaleOnce({
      hostLocaleSource: { getLocale: () => hostPromise },
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    storage.setItem(LOCALE_STORAGE_KEY, 'zh');
    resolveHost('en');
    const resolved = await pending;

    assert.equal(resolved, null);
    assert.deepEqual(applied, []);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), 'zh');
  });

  // 3. Host read failure fails softly without writing to storage.
  await withBrowserEnv({ navigatorLanguage: 'zh-CN' }, async ({ storage }) => {
    const applied = [];
    const resolved = await applyStartupHostLocaleOnce({
      hostLocaleSource: {
        async getLocale() {
          throw new Error('bridge unavailable');
        },
      },
      isStale: () => false,
      applyLocale: (locale) => applied.push(locale),
    });

    assert.equal(resolved, null);
    assert.deepEqual(applied, []);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
    assert.equal(storage.setCalls, 0);
  });
});

test('W0-01 / FIX-017: I18nProvider preserves synchronous initial render and wires read-once startup host locale effect', async () => {
  function Probe() {
    const { locale, t } = useI18n();
    return createElement('span', { 'data-locale': locale }, t('workspace.viewMatters'));
  }

  await withBrowserEnv({ navigatorLanguage: 'zh-CN', storedLocale: 'en' }, async () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(Probe)));
    assert.match(html, /data-locale="en"/);
    assert.match(html, /Tasks &amp; deliverables/);
  });

  const src = await readFile(new URL('../src/i18n.ts', import.meta.url), 'utf8');
  assert.match(src, /manualOverrideRef\.current\s*=\s*true/);
  assert.match(src, /applyStartupHostLocaleOnce\(\{/);
  assert.match(src, /isStale:\s*\(\)\s*=>\s*cancelled\s*\|\|\s*manualOverrideRef\.current/);
  assert.match(src, /document\.documentElement\.lang\s*=\s*locale\s*===\s*'zh'\s*\?\s*'zh-CN'\s*:\s*'en'/);
  assert.doesNotMatch(src, /setInterval|addEventListener\([^)]*locale/i);
});
