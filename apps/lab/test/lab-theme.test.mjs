import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const buildDir = mkdtempSync(path.join(root, '.tmp', 'lab-theme-'));

await build({
  stdin: {
    contents: `
      export {
        LAB_THEME_STORAGE_KEY,
        LAB_DENSITY_STORAGE_KEY,
        LabThemeProvider,
        readLabThemePreference,
        readLabDensityPreference,
        resolveLabInitialThemeSnapshot,
        useLabTheme,
      } from './src/shell/theme.tsx';
      export { SettingsRouteView } from './src/shell/routes/settings/view.tsx';
      export { i18n } from './src/shell/i18n/index.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  outfile: path.join(buildDir, 'bundle.mjs'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  logLevel: 'silent',
});

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

async function withDom({ dark = false, initialStorage = {} }, run) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  for (const [key, value] of Object.entries(initialStorage)) {
    dom.window.localStorage.setItem(key, value);
  }
  const listeners = new Set();
  let matchesDark = dark;
  const mediaQuery = {
    media: '(prefers-color-scheme: dark)',
    get matches() { return matchesDark; },
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener); },
  };
  dom.window.matchMedia = () => mediaQuery;
  const setSystemDark = (next) => {
    matchesDark = next;
    for (const listener of [...listeners]) listener({ matches: next, media: mediaQuery.media });
  };
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const mod = await import(pathToFileURL(path.join(buildDir, 'bundle.mjs')).href);
  await mod.i18n.changeLanguage('en');
  const { createRoot } = await import('react-dom/client');
  const rootEl = dom.window.document.getElementById('root');
  const reactRoot = createRoot(rootEl);
  try {
    await run({ dom, document: dom.window.document, reactRoot, mod, setSystemDark });
  } finally {
    await act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function defaultSettingsProps() {
  const idle = { status: 'idle', error: null };
  return {
    draftPersistence: true,
    savingDraftPreference: false,
    draftPreferenceError: null,
    onDraftPersistenceChange: () => {},
    notificationProjection: { ...idle, unread: null },
    refreshNotificationProjection: () => {},
    notificationListProjection: { ...idle, list: null },
    refreshNotificationListProjection: () => {},
    accountSettingsProjection: { ...idle, eligibility: null },
    refreshAccountSettingsProjection: () => {},
    humanChatProjection: { ...idle, chats: null },
    refreshHumanChatProjection: () => {},
  };
}

test('Lab defaults to system appearance (with live matchMedia listener) and compact density', async () => {
  await withDom({ dark: true }, async ({ document, reactRoot, mod, setSystemDark }) => {
    const snapshots = [];
    assert.deepEqual(mod.resolveLabInitialThemeSnapshot(), {
      scheme: 'dark',
      accentPack: 'nimi-accent',
      density: 'compact',
    });

    await act(async () => {
      reactRoot.render(
        React.createElement(
          mod.LabThemeProvider,
          { onThemeSnapshotChange: (snapshot) => snapshots.push(snapshot) },
          React.createElement(mod.SettingsRouteView, defaultSettingsProps()),
        ),
      );
    });

    assert.equal(document.documentElement.dataset.nimiScheme, 'dark');
    assert.equal(document.documentElement.classList.contains('dark'), true);
    assert.equal(document.documentElement.dataset.nimiDensity, 'compact');
    assert.equal(document.documentElement.style.colorScheme, 'dark');
    assert.deepEqual(snapshots.at(-1), { scheme: 'dark', accentPack: 'nimi-accent', density: 'compact' });

    await act(async () => {
      setSystemDark(false);
    });
    assert.equal(document.documentElement.dataset.nimiScheme, 'light');
    assert.equal(document.documentElement.classList.contains('dark'), false);
    assert.equal(document.documentElement.style.colorScheme, 'light');
    assert.deepEqual(snapshots.at(-1), { scheme: 'light', accentPack: 'nimi-accent', density: 'compact' });
  });
});

test('Settings appearance and density controls persist to localStorage and update live theme attributes', async () => {
  await withDom({ dark: false }, async ({ dom, document, reactRoot, mod }) => {
    await act(async () => {
      reactRoot.render(
        React.createElement(
          mod.LabThemeProvider,
          null,
          React.createElement(mod.SettingsRouteView, defaultSettingsProps()),
        ),
      );
    });

    const radio = (groupLabel, optionLabel) => {
      const group = document.querySelector(`[role="radiogroup"][aria-label="${groupLabel}"]`);
      assert.ok(group, `radiogroup ${groupLabel}`);
      return [...group.querySelectorAll('[role="radio"]')].find((node) => node.textContent === optionLabel);
    };

    const darkButton = radio('Appearance', 'Dark');
    assert.ok(darkButton);
    await act(async () => { darkButton.click(); });
    assert.equal(document.documentElement.dataset.nimiScheme, 'dark');
    assert.equal(dom.window.localStorage.getItem(mod.LAB_THEME_STORAGE_KEY), 'dark');

    const regularButton = radio('Density', 'Regular');
    assert.ok(regularButton);
    await act(async () => { regularButton.click(); });
    assert.equal(document.documentElement.dataset.nimiDensity, undefined);
    assert.equal(dom.window.localStorage.getItem(mod.LAB_DENSITY_STORAGE_KEY), 'regular');

    assert.equal(mod.readLabThemePreference(), 'dark');
    assert.equal(mod.readLabDensityPreference(), 'regular');
  });
});
