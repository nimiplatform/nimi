import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  changeLocale,
  createDesktopI18n,
  formatRelativeLocaleTime,
  initI18n,
  i18n,
  onI18nIssue,
  resetI18nIssueTrackingForTests,
} from '../src/shell/renderer/i18n';
import { readDesktopLocale } from './helpers/read-desktop-locale';

const RENDERER_ROOT = resolve(import.meta.dirname, '../src/shell/renderer');
const RUNTIME_CONFIG_PANEL_VIEW_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx',
);

function flattenLocaleKeys(input: unknown, prefix = ''): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(input).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenLocaleKeys(value, next);
    }
    return [next];
  });
}

function getValueAtKey(input: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, input);
}

async function collectRendererSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectRendererSourceFiles(fullPath);
    }
    return /\.(ts|tsx|html)$/.test(entry.name) ? [fullPath] : [];
  }));
  return nested.flat();
}

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
  resetI18nIssueTrackingForTests();
});

test.afterEach(() => {
  restoreDomGlobals();
});

test('changeLocale synchronizes document title and lang', async () => {
  await initI18n();

  await changeLocale('zh');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(document.title, 'Nimi 运行时');

  await changeLocale('en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.title, 'Nimi Runtime');
});

test('formatRelativeLocaleTime follows current locale', async () => {
  await initI18n();

  const ts = new Date(Date.now() - 5 * 60_000).toISOString();

  await changeLocale('en');
  assert.equal(formatRelativeLocaleTime(ts), '5m ago');

  await changeLocale('zh');
  assert.equal(formatRelativeLocaleTime(ts), '5 分钟前');
});

test('missing renderer translation keys emit issues and return fallback copy without crashing', async () => {
  await initI18n();

  const captured: Array<{ code: string; key: string; source: string }> = [];
  const unsubscribe = onI18nIssue((issue) => {
    if (issue.key === 'I18nSpecRegression.missingRendererCopy') {
      captured.push({
        code: issue.code,
        key: issue.key,
        source: issue.source,
      });
    }
  });

  try {
    const fallback = i18n.t('I18nSpecRegression.missingRendererCopy');
    assert.equal(fallback, 'Missing Renderer Copy');
    assert.deepEqual(captured, [{
      code: 'i18n:missing-key',
      key: 'I18nSpecRegression.missingRendererCopy',
      source: 'parseMissingKeyHandler',
    }]);
  } finally {
    unsubscribe();
  }
});

test('duplicate missing renderer translation keys emit a single issue per session fingerprint', async () => {
  await initI18n();

  const captured: Array<{ code: string; key: string; source: string }> = [];
  const unsubscribe = onI18nIssue((issue) => {
    if (issue.key === 'I18nSpecRegression.duplicateMissingRendererCopy') {
      captured.push({
        code: issue.code,
        key: issue.key,
        source: issue.source,
      });
    }
  });

  try {
    assert.equal(i18n.t('I18nSpecRegression.duplicateMissingRendererCopy'), 'Duplicate Missing Renderer Copy');
    assert.equal(i18n.t('I18nSpecRegression.duplicateMissingRendererCopy'), 'Duplicate Missing Renderer Copy');
    assert.deepEqual(captured, [{
      code: 'i18n:missing-key',
      key: 'I18nSpecRegression.duplicateMissingRendererCopy',
      source: 'parseMissingKeyHandler',
    }]);
  } finally {
    unsubscribe();
  }
});

test('createDesktopI18n owns locale, diagnostics, and clock per renderer instance', async () => {
  const first = createDesktopI18n({
    initialLocale: 'en',
    development: false,
    now: () => Date.UTC(2026, 0, 1, 0, 5),
  });
  const second = createDesktopI18n({
    initialLocale: 'zh',
    development: false,
    now: () => Date.UTC(2026, 0, 1, 1, 0),
  });
  const firstIssues: string[] = [];
  const secondIssues: string[] = [];
  first.onIssue((issue) => firstIssues.push(issue.key));
  second.onIssue((issue) => secondIssues.push(issue.key));

  await Promise.all([first.init(), second.init()]);
  assert.equal(first.getCurrentLocale(), 'en');
  assert.equal(second.getCurrentLocale(), 'zh');
  assert.equal(
    first.formatRelativeTime(new Date(Date.UTC(2026, 0, 1, 0, 0))),
    '5m ago',
  );
  assert.equal(
    second.formatRelativeTime(new Date(Date.UTC(2026, 0, 1, 0, 0))),
    '1 小时前',
  );

  assert.equal(first.instance.t('I18nSpecRegression.instanceOwned'), 'Instance Owned');
  assert.deepEqual(firstIssues, ['I18nSpecRegression.instanceOwned']);
  assert.deepEqual(secondIssues, []);
});

test('renderer translation key usages resolve in en locale', async () => {
  const en = readDesktopLocale('en');
  const enKeys = new Set(flattenLocaleKeys(en));
  const sourceFiles = await collectRendererSourceFiles(RENDERER_ROOT);
  const directKeyPattern = /\b(?:i18n\.t|t|deps\.translate)\(\s*['"]([^'"]+)['"]/g;
  const seenKeys = new Set<string>();

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = directKeyPattern.exec(source)) !== null) {
      const key = match[1];
      if (key) {
        seenKeys.add(key);
      }
    }
  }

  const missingKeys = [...seenKeys]
    .filter((key) => !enKeys.has(key))
    .sort((left, right) => left.localeCompare(right));

  assert.deepEqual(
    missingKeys,
    [],
    `en.json is missing renderer translation keys: ${missingKeys.join(', ')}`,
  );
});

test('known dynamic desktop locale keys exist in both locales', async () => {
  const localeEntries = [
    ['en', readDesktopLocale('en')],
    ['zh', readDesktopLocale('zh')],
  ] as const;
  const requiredKeys = [
    'Menu.profile',
    'Menu.settings',
    'Menu.termsOfService',
    'Menu.privacyPolicy',
    'Menu.logout',
    'NotificationPanel.filters.all',
    'NotificationPanel.filters.gift',
    'NotificationPanel.filters.request',
    'NotificationPanel.filters.mention',
    'NotificationPanel.filters.like',
    'NotificationPanel.filters.system',
    'NotificationPanel.typeNotifications.friendRequestReceived',
    'NotificationPanel.typeNotifications.friendRequestAccepted',
    'NotificationPanel.typeNotifications.friendRequestRejected',
    'NotificationPanel.typeNotifications.giftReceived',
    'NotificationPanel.typeNotifications.giftAccepted',
    'NotificationPanel.typeNotifications.giftRejected',
    'NotificationPanel.typeNotifications.giftStatusUpdated',
    'NotificationPanel.typeNotifications.reviewReceived',
    'NotificationPanel.typeNotifications.system',
    'Chat.agentDebugCopyLabel',
    'Chat.agentDebugCopiedLabel',
    'Chat.agentDebugFollowUpLabel',
    'BridgeErrors.codes.RUNTIME_CALL_FAILED',
    'runtimeConfig.local.assetRemoved',
  ];

  for (const [locale, localeData] of localeEntries) {
    for (const key of requiredKeys) {
      const value = getValueAtKey(localeData, key);
      assert.equal(typeof value, 'string', `${locale} locale is missing ${key}`);
      assert.match(String(value || ''), /\S/, `${locale} locale has empty ${key}`);
    }
  }
});

test('runtime config sidebar section keys are defined in en locale', async () => {
  const panelViewSource = await readFile(RUNTIME_CONFIG_PANEL_VIEW_PATH, 'utf8');
  const en = readDesktopLocale('en');
  // T2.4 six-section IA: a single canonical "Runtime" sidebar group.
  const requiredKeys = [
    'runtimeConfig.sidebar.section.runtime',
  ];

  for (const key of requiredKeys) {
    assert.match(
      panelViewSource,
      new RegExp(key.replaceAll('.', '\\.')),
      `runtime config panel must reference ${key}`,
    );
    const value = getValueAtKey(en, key);
    assert.equal(typeof value, 'string', `en locale is missing ${key}`);
    assert.match(String(value || ''), /\S/, `en locale has empty ${key}`);
  }
});
