import i18next, { type i18n as I18nInstance } from 'i18next';
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

export type DesktopI18nResource = {
  readonly instance: I18nInstance;
  now(): number;
  init(): Promise<void>;
  changeLocale(locale: SupportedLocale): Promise<void>;
  getCurrentLocale(): SupportedLocale;
  onIssue(listener: (issue: I18nIssue) => void): () => void;
  resetIssueTracking(): void;
  formatNumber(value: unknown, options?: Intl.NumberFormatOptions, locale?: string): string;
  formatDate(value: unknown, options?: Intl.DateTimeFormatOptions, locale?: string): string;
  formatDateTime(value: unknown, locale?: string): string;
  formatRelativeTime(value: unknown, locale?: string): string;
};

export type CreateDesktopI18nInput = {
  readonly initialLocale: SupportedLocale;
  readonly development: boolean;
  readonly now: () => number;
  readonly persistLocale?: (locale: SupportedLocale) => Promise<void> | void;
  readonly syncDocument?: (input: {
    locale: SupportedLocale;
    lang: string;
    title: string;
  }) => Promise<void> | void;
};

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  zh: '简体中文',
};

export function getLocaleLabel(locale: SupportedLocale): string {
  return LOCALE_LABELS[locale];
}

export function resolveSupportedLocale(value: unknown): SupportedLocale {
  const normalized = String(value || '').trim();
  return (SUPPORTED_LOCALES as readonly string[]).includes(normalized)
    ? normalized as SupportedLocale
    : 'en';
}

function resolveDocumentLang(locale: SupportedLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

async function loadMessages(locale: SupportedLocale): Promise<Record<string, unknown>> {
  switch (locale) {
    case 'en': return (await import('../locales/en')).default as Record<string, unknown>;
    case 'zh': return (await import('../locales/zh')).default as Record<string, unknown>;
  }
}

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

function issueFingerprint(issue: I18nIssue): string {
  return [
    issue.code,
    issue.locale,
    issue.namespace,
    issue.key,
    issue.source,
  ].join('|');
}

export function createDesktopI18n(input: CreateDesktopI18nInput): DesktopI18nResource {
  const instance = i18next.createInstance();
  const issueListeners = new Set<(issue: I18nIssue) => void>();
  const reportedIssueFingerprints = new Set<string>();
  const now = input.now;
  let initPromise: Promise<void> | null = null;

  function emitIssue(issue: I18nIssue): void {
    const fingerprint = issueFingerprint(issue);
    if (reportedIssueFingerprints.has(fingerprint)) {
      return;
    }
    reportedIssueFingerprints.add(fingerprint);
    for (const listener of issueListeners) {
      try {
        listener(issue);
      } catch {
        // A diagnostics observer cannot break renderer localization.
      }
    }
  }

  function reportMissingKey(missing: {
    locale: string;
    namespace: string;
    key: string;
    source: string;
  }): string {
    const locale = String(missing.locale || '').trim() || 'en';
    const namespace = String(missing.namespace || '').trim() || 'translation';
    const key = String(missing.key || '').trim();
    emitIssue({
      code: 'i18n:missing-key',
      key,
      locale,
      namespace,
      source: missing.source,
      severity: input.development ? 'error' : 'warn',
      chain: [
        `locale:${locale}`,
        `namespace:${namespace}`,
        `key:${key || 'unknown'}`,
        `source:${missing.source}`,
      ],
    });
    return humanizeMissingKey(key);
  }

  function reportBundleMissing(missing: {
    locale: string;
    source: string;
    key: string;
    reason: string;
  }): void {
    const locale = String(missing.locale || '').trim() || 'en';
    emitIssue({
      code: 'i18n:bundle-missing',
      key: String(missing.key || '').trim() || 'bundle',
      locale,
      namespace: 'translation',
      source: missing.source,
      severity: 'error',
      chain: [
        `locale:${locale}`,
        `source:${missing.source}`,
        `reason:${String(missing.reason || '').trim() || 'unknown'}`,
      ],
    });
  }

  function translateOrFallback(
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>,
  ): string {
    if (!instance.isInitialized) {
      return defaultValue;
    }
    const translated = instance.t(key, {
      defaultValue,
      ...(options || {}),
    });
    return typeof translated === 'string' && translated.trim().length > 0
      ? translated
      : defaultValue;
  }

  async function syncDocument(locale: SupportedLocale): Promise<void> {
    await input.syncDocument?.({
      locale,
      lang: resolveDocumentLang(locale),
      title: translateOrFallback(DOCUMENT_TITLE_TRANSLATION_KEY, 'Nimi'),
    });
  }

  async function init(): Promise<void> {
    if (initPromise) {
      return initPromise;
    }
    initPromise = (async () => {
      let messages: Record<string, unknown>;
      try {
        messages = await loadMessages(input.initialLocale);
      } catch (error) {
        reportBundleMissing({
          locale: input.initialLocale,
          source: 'initI18n:loadMessages',
          key: 'translation',
          reason: error instanceof Error ? error.message : String(error || 'load failed'),
        });
        messages = await loadMessages('en');
      }
      await instance.use(initReactI18next).init({
        lng: input.initialLocale,
        fallbackLng: 'en',
        interpolation: { escapeValue: false },
        resources: {
          [input.initialLocale]: { translation: messages },
        },
        missingKeyHandler: (lngs, namespace, key) => {
          const locale = Array.isArray(lngs)
            ? lngs[0] || input.initialLocale
            : lngs || input.initialLocale;
          void reportMissingKey({
            locale: String(locale || input.initialLocale),
            namespace: namespace || 'translation',
            key,
            source: 'missingKeyHandler',
          });
        },
        parseMissingKeyHandler: (key) => reportMissingKey({
          locale: String(instance.resolvedLanguage || input.initialLocale),
          namespace: 'translation',
          key,
          source: 'parseMissingKeyHandler',
        }),
      });
      await syncDocument(input.initialLocale);
    })();
    return initPromise;
  }

  async function changeLocale(locale: SupportedLocale): Promise<void> {
    if (!instance.hasResourceBundle(locale, 'translation')) {
      try {
        const messages = await loadMessages(locale);
        instance.addResourceBundle(locale, 'translation', messages, true, false);
      } catch (error) {
        reportBundleMissing({
          locale,
          source: 'changeLocale:loadMessages',
          key: 'translation',
          reason: error instanceof Error ? error.message : String(error || 'load failed'),
        });
        const fallbackMessages = await loadMessages('en');
        instance.addResourceBundle(locale, 'translation', fallbackMessages, true, false);
      }
    }
    await instance.changeLanguage(locale);
    await syncDocument(locale);
    await input.persistLocale?.(locale);
  }

  function getCurrentLocale(): SupportedLocale {
    return resolveSupportedLocale(instance.language);
  }

  function resolveIntlLocale(locale?: string): string {
    return String(locale || getCurrentLocale()).trim() === 'zh' ? 'zh-CN' : 'en-US';
  }

  function formatNumber(
    value: unknown,
    options?: Intl.NumberFormatOptions,
    locale?: string,
  ): string {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '--';
    }
    return new Intl.NumberFormat(resolveIntlLocale(locale), options).format(value);
  }

  function formatDate(
    value: unknown,
    options?: Intl.DateTimeFormatOptions,
    locale?: string,
  ): string {
    const date = typeof value === 'number'
      ? new Date(value)
      : new Date(String(value || ''));
    if (Number.isNaN(date.getTime())) {
      return typeof value === 'string' ? value : '--';
    }
    return new Intl.DateTimeFormat(resolveIntlLocale(locale), options).format(date);
  }

  function formatDateTime(value: unknown, locale?: string): string {
    return formatDate(value, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }, locale);
  }

  function formatRelativeTime(value: unknown, locale?: string): string {
    const date = typeof value === 'number'
      ? new Date(value)
      : new Date(String(value || ''));
    if (Number.isNaN(date.getTime())) {
      return typeof value === 'string' ? value : '--';
    }
    const normalizedLocale = String(locale || getCurrentLocale()).trim() || 'en';
    const diffMs = now() - date.getTime();
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

  return {
    instance,
    now,
    init,
    changeLocale,
    getCurrentLocale,
    onIssue(listener) {
      issueListeners.add(listener);
      return () => issueListeners.delete(listener);
    },
    resetIssueTracking() {
      reportedIssueFingerprints.clear();
    },
    formatNumber,
    formatDate,
    formatDateTime,
    formatRelativeTime,
  };
}
