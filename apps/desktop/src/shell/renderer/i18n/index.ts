import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'nimi.shell.locale';
export const DOCUMENT_TITLE_TRANSLATION_KEY = 'Document.title';

export type I18nIssueCode = 'i18n:missing-key' | 'i18n:bundle-missing';
export type I18nIssueSeverity = 'warn' | 'error';

export type I18nIssue = {
  code: I18nIssueCode;
  key: string;
  locale: string;
  namespace: string;
  source: string;
  severity: I18nIssueSeverity;
  chain: string[];
};

type I18nIssueListener = (issue: I18nIssue) => void;

const issueListeners = new Set<I18nIssueListener>();

function translateOrFallback(
  key: string,
  defaultValue: string,
  options?: Record<string, unknown>,
): string {
  if (!i18n.isInitialized) {
    return defaultValue;
  }
  const translated = i18n.t(key, {
    defaultValue,
    ...(options || {}),
  });
  return typeof translated === 'string' && translated.trim().length > 0
    ? translated
    : defaultValue;
}

function emitI18nIssue(issue: I18nIssue): void {
  issueListeners.forEach((listener) => {
    try {
      listener(issue);
    } catch {
      // no-op
    }
  });
}

export function onI18nIssue(listener: I18nIssueListener): () => void {
  issueListeners.add(listener);
  return () => issueListeners.delete(listener);
}

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  zh: '简体中文',
};

export function getLocaleLabel(locale: SupportedLocale): string {
  return LOCALE_LABELS[locale];
}

function readStoredLocale(): SupportedLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as SupportedLocale;
    }
  } catch {
    // no-op
  }
  return 'en';
}

function resolveDocumentLang(locale: SupportedLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

function syncDocumentState(locale: SupportedLocale): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.lang = resolveDocumentLang(locale);
  document.title = translateOrFallback(
    DOCUMENT_TITLE_TRANSLATION_KEY,
    'Nimi Desktop Runtime',
  );
}

async function loadMessages(locale: SupportedLocale): Promise<Record<string, unknown>> {
  switch (locale) {
    case 'en': return (await import('../locales/en.json')).default as Record<string, unknown>;
    case 'zh': return (await import('../locales/zh.json')).default as Record<string, unknown>;
  }
}

const initialLocale = readStoredLocale();

// Synchronously load the initial locale during module evaluation
// We pre-populate resources synchronously using a placeholder;
// loadAndInit() must be awaited before rendering.
export const i18n = i18next.createInstance();

let initPromise: Promise<void> | null = null;

function humanizeMissingKey(key: string): string {
  const keyText = String(key || '').trim();
  if (!keyText) {
    return 'Missing translation';
  }
  const tail = keyText.includes('.') ? keyText.split('.').at(-1) || keyText : keyText;
  const normalized = tail
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!normalized) {
    return 'Missing translation';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function shouldFailOnMissingKey(): boolean {
  return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
}

function reportMissingKey(input: {
  locale: string;
  namespace: string;
  key: string;
  source: string;
}): string {
  const normalizedLocale = String(input.locale || '').trim() || 'en';
  const normalizedNamespace = String(input.namespace || '').trim() || 'translation';
  const normalizedKey = String(input.key || '').trim();
  const severity: I18nIssueSeverity = shouldFailOnMissingKey() ? 'error' : 'warn';
  const chain = [
    `locale:${normalizedLocale}`,
    `namespace:${normalizedNamespace}`,
    `key:${normalizedKey || 'unknown'}`,
    `source:${input.source}`,
  ];

  emitI18nIssue({
    code: 'i18n:missing-key',
    key: normalizedKey,
    locale: normalizedLocale,
    namespace: normalizedNamespace,
    source: input.source,
    severity,
    chain,
  });

  const fallback = humanizeMissingKey(normalizedKey);
  if (severity === 'error') {
    throw new Error(`i18n missing key: ${chain.join(' -> ')}`);
  }
  return fallback;
}

function reportBundleMissing(input: {
  locale: string;
  source: string;
  key: string;
  reason: string;
}): void {
  const normalizedLocale = String(input.locale || '').trim() || 'en';
  emitI18nIssue({
    code: 'i18n:bundle-missing',
    key: String(input.key || '').trim() || 'bundle',
    locale: normalizedLocale,
    namespace: 'translation',
    source: input.source,
    severity: 'error',
    chain: [
      `locale:${normalizedLocale}`,
      `source:${input.source}`,
      `reason:${String(input.reason || '').trim() || 'unknown'}`,
    ],
  });
}

export async function initI18n(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let messages: Record<string, unknown>;
    try {
      messages = await loadMessages(initialLocale);
    } catch (error) {
      reportBundleMissing({
        locale: initialLocale,
        source: 'initI18n:loadMessages',
        key: 'translation',
        reason: error instanceof Error ? error.message : String(error || 'load failed'),
      });
      messages = await loadMessages('en');
    }
    await i18n.use(initReactI18next).init({
      lng: initialLocale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      logBanner: false,
      resources: {
        [initialLocale]: { translation: messages },
      },
      missingKeyHandler: (lngs, namespace, key) => {
        const locale = Array.isArray(lngs) ? (lngs[0] || initialLocale) : (lngs || initialLocale);
        void reportMissingKey({
          locale: String(locale || initialLocale),
          namespace: namespace || 'translation',
          key,
          source: 'missingKeyHandler',
        });
      },
      parseMissingKeyHandler: (key) => reportMissingKey({
        locale: String(i18n.resolvedLanguage || initialLocale),
        namespace: 'translation',
        key,
        source: 'parseMissingKeyHandler',
      }),
    });
    syncDocumentState(initialLocale);
  })();
  return initPromise;
}

export async function changeLocale(locale: SupportedLocale): Promise<void> {
  if (!i18n.hasResourceBundle(locale, 'translation')) {
    try {
      const messages = await loadMessages(locale);
      i18n.addResourceBundle(locale, 'translation', messages, true, false);
    } catch (error) {
      reportBundleMissing({
        locale,
        source: 'changeLocale:loadMessages',
        key: 'translation',
        reason: error instanceof Error ? error.message : String(error || 'load failed'),
      });
      const fallbackMessages = await loadMessages('en');
      i18n.addResourceBundle(locale, 'translation', fallbackMessages, true, false);
    }
  }
  await i18n.changeLanguage(locale);
  syncDocumentState(locale);
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // no-op
  }
}

export function getCurrentLocale(): SupportedLocale {
  const lng = i18n.language;
  if (lng && (SUPPORTED_LOCALES as readonly string[]).includes(lng)) {
    return lng as SupportedLocale;
  }
  return 'en';
}

function resolveIntlLocale(locale?: string): string {
  const normalizedLocale = String(locale || getCurrentLocale() || 'en').trim();
  if (normalizedLocale === 'zh') {
    return 'zh-CN';
  }
  return 'en-US';
}

export function formatLocaleNumber(
  value: unknown,
  options?: Intl.NumberFormatOptions,
  locale?: string,
): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }
  return new Intl.NumberFormat(resolveIntlLocale(locale), options).format(value);
}

export function formatLocaleDate(
  value: unknown,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '--';
  }
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), options).format(date);
}

export function formatLocaleDateTime(
  value: unknown,
  locale?: string,
): string {
  return formatLocaleDate(value, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }, locale);
}

export function formatRelativeLocaleTime(
  value: unknown,
  locale?: string,
): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '--';
  }

  const normalizedLocale = String(locale || getCurrentLocale() || 'en').trim() || 'en';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return translateOrFallback('Time.justNow', 'just now', { lng: normalizedLocale });
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return translateOrFallback('Time.secondsAgo', `${seconds}s ago`, {
      lng: normalizedLocale,
      count: seconds,
    });
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return translateOrFallback('Time.minutesAgo', `${minutes}m ago`, {
      lng: normalizedLocale,
      count: minutes,
    });
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return translateOrFallback('Time.hoursAgo', `${hours}h ago`, {
      lng: normalizedLocale,
      count: hours,
    });
  }

  const days = Math.floor(hours / 24);
  return translateOrFallback('Time.daysAgo', `${days}d ago`, {
    lng: normalizedLocale,
    count: days,
  });
}
