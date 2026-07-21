import {
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import {
  createDesktopI18n,
  LOCALE_STORAGE_KEY,
  resolveSupportedLocale,
  type I18nIssue,
  type SupportedLocale,
} from './desktop-i18n.js';

export {
  createDesktopI18n,
  DOCUMENT_TITLE_TRANSLATION_KEY,
  getLocaleLabel,
  LOCALE_STORAGE_KEY,
  resolveSupportedLocale,
  SUPPORTED_LOCALES,
} from './desktop-i18n.js';
export type {
  CreateDesktopI18nInput,
  DesktopI18nResource,
  I18nIssue,
  I18nIssueCode,
  I18nIssueSeverity,
  SupportedLocale,
} from './desktop-i18n.js';

function readStoredLocale(): SupportedLocale {
  const result = readStorageTextFrom(
    resolveBrowserStorage('local'),
    LOCALE_STORAGE_KEY,
  );
  return resolveSupportedLocale(result.state === 'ready' ? result.value : '');
}

export const productionDesktopI18n = createDesktopI18n({
  initialLocale: readStoredLocale(),
  development: Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
  now: Date.now,
  persistLocale(locale) {
    writeStorageTextTo(
      resolveBrowserStorage('local'),
      LOCALE_STORAGE_KEY,
      locale,
    );
  },
  syncDocument({ lang, title }) {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.lang = lang;
    document.title = title;
  },
});

export const i18n = productionDesktopI18n.instance;

export function initI18n(): Promise<void> {
  return productionDesktopI18n.init();
}

export function changeLocale(locale: SupportedLocale): Promise<void> {
  return productionDesktopI18n.changeLocale(locale);
}

export function getCurrentLocale(): SupportedLocale {
  return productionDesktopI18n.getCurrentLocale();
}

export function onI18nIssue(listener: (issue: I18nIssue) => void): () => void {
  return productionDesktopI18n.onIssue(listener);
}

export function resetI18nIssueTrackingForTests(): void {
  productionDesktopI18n.resetIssueTracking();
}

export function formatLocaleNumber(
  value: unknown,
  options?: Intl.NumberFormatOptions,
  locale?: string,
): string {
  return productionDesktopI18n.formatNumber(value, options, locale);
}

export function formatLocaleDate(
  value: unknown,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return productionDesktopI18n.formatDate(value, options, locale);
}

export function formatLocaleDateTime(
  value: unknown,
  locale?: string,
): string {
  return productionDesktopI18n.formatDateTime(value, locale);
}

export function formatRelativeLocaleTime(
  value: unknown,
  locale?: string,
): string {
  return productionDesktopI18n.formatRelativeTime(value, locale);
}
