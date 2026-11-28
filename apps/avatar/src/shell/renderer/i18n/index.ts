// Wave 2 — Avatar i18n bootstrap.
// Synchronously initializes i18next + react-i18next with the resolved locale's
// resource bundle BEFORE React mount, so every t() call from the very first
// render is a real translation (no async fallback, no flash of English).
//
// Locale resolution order:
//   1. Kit browser storage key `nimi.avatar.locale` (persisted user override)
//   2. Host startup locale read once via `applyStartupHostLocaleOnce()` before
//      mount (never persisted to `localStorage` so default launches follow Home)
//   3. navigator.language → first matching SUPPORTED_LOCALES prefix
//   4. 'en'
//
// All keys are declared in the app-owned `i18n/key-catalog.yaml`.
// `pnpm --filter @nimiplatform/avatar check:spec-consistency` enforces 1:1
// alignment between the app catalog and both locale JSON files.

import i18nextCore from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import {
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import { getShellHostLocale } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  readNimiHostLocale,
  resolveNimiStartupLocale,
  type NimiHostLocaleSource,
} from '@nimiplatform/sdk/app';

import enAvatar from '../locales/en/avatar.json' with { type: 'json' };
import zhAvatar from '../locales/zh/avatar.json' with { type: 'json' };

export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'nimi.avatar.locale';
export const I18N_NAMESPACE = 'avatar';

const DEFAULT_HOST_LOCALE_SOURCE: NimiHostLocaleSource = {
  getLocale: getShellHostLocale,
};

const RESOURCES: Record<SupportedLocale, Record<string, unknown>> = {
  en: enAvatar as Record<string, unknown>,
  zh: zhAvatar as Record<string, unknown>,
};

function readStoredLocale(): SupportedLocale | null {
  const stored = readStorageTextFrom(resolveBrowserStorage('local'), LOCALE_STORAGE_KEY);
  if (stored.state === 'ready' && (SUPPORTED_LOCALES as readonly string[]).includes(stored.value)) {
    return stored.value as SupportedLocale;
  }
  return null;
}

function readNavigatorLanguage(): string | null {
  return typeof navigator !== 'undefined' && typeof navigator.language === 'string'
    ? navigator.language
    : null;
}

function detectInitialLocale(): SupportedLocale {
  return resolveNimiStartupLocale({
    supportedLocales: SUPPORTED_LOCALES,
    storedLocale: readStoredLocale(),
    navigatorLanguage: readNavigatorLanguage(),
    fallback: 'en',
  });
}

function syncDocumentLocale(locale: SupportedLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title = t('Avatar.shell.document_title');
  }
}

const initialLocale = detectInitialLocale();

export const i18n = i18nextCore.createInstance();

// Synchronous init — resources are bundled, so no await needed before mount.
void i18n.use(initReactI18next).init({
  lng: initialLocale,
  fallbackLng: 'en',
  defaultNS: I18N_NAMESPACE,
  ns: [I18N_NAMESPACE],
  resources: {
    en: { [I18N_NAMESPACE]: RESOURCES.en },
    zh: { [I18N_NAMESPACE]: RESOURCES.zh },
  },
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = initialLocale === 'zh' ? 'zh-CN' : 'en';
}

let manualLocaleMutationCount = 0;

export function getCurrentLocale(): SupportedLocale {
  const lng = i18n.language;
  if (lng && (SUPPORTED_LOCALES as readonly string[]).includes(lng)) {
    return lng as SupportedLocale;
  }
  return 'en';
}

export async function changeLocale(locale: SupportedLocale): Promise<void> {
  manualLocaleMutationCount += 1;
  await i18n.changeLanguage(locale);
  syncDocumentLocale(locale);
  writeStorageTextTo(resolveBrowserStorage('local'), LOCALE_STORAGE_KEY, locale);
}

export async function applyStartupHostLocaleOnce(
  hostLocaleSource: NimiHostLocaleSource | null = DEFAULT_HOST_LOCALE_SOURCE,
): Promise<SupportedLocale> {
  const storedLocale = readStoredLocale();
  if (storedLocale !== null) {
    if (getCurrentLocale() !== storedLocale) {
      await i18n.changeLanguage(storedLocale);
    }
    syncDocumentLocale(storedLocale);
    return storedLocale;
  }

  const mutationBeforeRead = manualLocaleMutationCount;
  const hostLocale = await readNimiHostLocale(hostLocaleSource);

  const storedAfterRead = readStoredLocale();
  if (manualLocaleMutationCount !== mutationBeforeRead || storedAfterRead !== null) {
    const current = storedAfterRead ?? getCurrentLocale();
    if (getCurrentLocale() !== current) {
      await i18n.changeLanguage(current);
    }
    syncDocumentLocale(current);
    return current;
  }

  const resolved = resolveNimiStartupLocale({
    supportedLocales: SUPPORTED_LOCALES,
    storedLocale: null,
    hostLocale,
    navigatorLanguage: readNavigatorLanguage(),
    fallback: 'en',
  });

  if (getCurrentLocale() !== resolved) {
    await i18n.changeLanguage(resolved);
  }
  syncDocumentLocale(resolved);
  return resolved;
}

// Re-export the React hook so consumers don't import react-i18next directly,
// keeping a single chokepoint for any future migration.
export { useTranslation };

// `t` is convenient when a hook is overkill (e.g. inside non-React utilities
// or one-off renders). Always defaults to the avatar namespace.
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: I18N_NAMESPACE, ...(options ?? {}) }) as string;
}
