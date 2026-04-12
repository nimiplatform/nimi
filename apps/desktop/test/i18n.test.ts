import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  changeLocale,
  formatRelativeLocaleTime,
  initI18n,
  i18n,
  onI18nIssue,
  resetI18nIssueTrackingForTests,
} from '../src/shell/renderer/i18n';

const RENDERER_ROOT = resolve(import.meta.dirname, '../src/shell/renderer');
const EN_LOCALE_PATH = resolve(import.meta.dirname, '../src/shell/renderer/locales/en.json');
const ZH_LOCALE_PATH = resolve(import.meta.dirname, '../src/shell/renderer/locales/zh.json');
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

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
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

test('auth runtime locale keys exist in both desktop locales', async () => {
  const localePaths = [EN_LOCALE_PATH, ZH_LOCALE_PATH];
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

test('renderer translation key usages resolve in en locale', async () => {
  const en = await readJson(EN_LOCALE_PATH);
  const enKeys = new Set(flattenLocaleKeys(en));
  const sourceFiles = await collectRendererSourceFiles(RENDERER_ROOT);
  const directKeyPattern = /\b(?:i18n\.t|t|tModHub|deps\.translate)\(\s*['"]([^'"]+)['"]/g;
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
    ['en', await readJson(EN_LOCALE_PATH)],
    ['zh', await readJson(ZH_LOCALE_PATH)],
  ] as const;
  const requiredKeys = [
    'SecuritySettings.copySecretSuccess',
    'Menu.profile',
    'Menu.wallet',
    'Menu.settings',
    'Menu.termsOfService',
    'Menu.privacyPolicy',
    'Menu.logout',
    'ModHub.statusFailed',
    'ModHub.statusConflict',
    'ModHub.statusUpdateReady',
    'ModHub.statusEnabled',
    'ModHub.statusDisabled',
    'ModHub.statusAvailable',
    'ModHub.actionInstall',
    'ModHub.actionUpdate',
    'ModHub.actionOpen',
    'ModHub.actionEnable',
    'ModHub.actionDisable',
    'ModHub.actionRemove',
    'ModHub.actionRetry',
    'ModHub.actionOpenFolder',
    'ModHub.actionSettings',
    'ModHub.actionLoading',
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
    'Chat.schedulingDeniedTitle',
    'Chat.schedulingQueueRequiredTitle',
    'Chat.schedulingPreemptionRiskTitle',
    'Chat.schedulingSlowdownRiskTitle',
    'Chat.schedulingUnknownTitle',
    'Chat.schedulingDeniedDetail',
    'Chat.schedulingQueueRequiredDetail',
    'Chat.schedulingPreemptionRiskDetail',
    'Chat.schedulingSlowdownRiskDetail',
    'Chat.schedulingSlowdownRiskBusyDetail',
    'Chat.schedulingUnknownDetail',
    'Chat.agentDebugCopyLabel',
    'Chat.agentDebugCopiedLabel',
    'Chat.agentDebugFollowUpLabel',
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
  const en = await readJson(EN_LOCALE_PATH);
  const requiredKeys = [
    'runtimeConfig.sidebar.section.core',
    'runtimeConfig.sidebar.section.connectors',
    'runtimeConfig.sidebar.section.operations',
    'runtimeConfig.sidebar.section.system',
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
