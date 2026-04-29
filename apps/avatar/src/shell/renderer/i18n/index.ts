// Wave 2 — Avatar i18n bootstrap.
// Synchronously initializes i18next + react-i18next with the resolved locale's
// resource bundle BEFORE React mount, so every t() call from the very first
// render is a real translation (no async fallback, no flash of English).
//
// Locale resolution order:
//   1. localStorage `nimi.avatar.locale` (persisted user choice — Wave 4 will
//      surface a switcher in the settings popover)
//   2. navigator.language → first matching SUPPORTED_LOCALES prefix
//   3. 'en'
//
// All keys are declared in spec/kernel/tables/i18n-keys.yaml (Wave 2 admit).
// `pnpm --filter @nimiplatform/avatar check:spec-consistency` enforces 1:1
// alignment between the spec table and both locale JSON files.

import i18nextCore from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';

import enAvatar from '../locales/en/avatar.json' with { type: 'json' };
import zhAvatar from '../locales/zh/avatar.json' with { type: 'json' };

export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'nimi.avatar.locale';
export const I18N_NAMESPACE = 'avatar';

const RESOURCES: Record<SupportedLocale, Record<string, unknown>> = {
  en: enAvatar as Record<string, unknown>,
  zh: zhAvatar as Record<string, unknown>,
};

function detectInitialLocale(): SupportedLocale {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_STORAGE_KEY) : null;
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as SupportedLocale;
    }
  } catch {
    // localStorage may be unavailable in some Tauri webview cold starts.
  }

  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('en')) return 'en';
  }
  return 'en';
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
  initImmediate: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = initialLocale === 'zh' ? 'zh-CN' : 'en';
}

export function getCurrentLocale(): SupportedLocale {
  const lng = i18n.language;
  if (lng && (SUPPORTED_LOCALES as readonly string[]).includes(lng)) {
    return lng as SupportedLocale;
  }
  return 'en';
}

export async function changeLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // No persistence available — runtime locale still applies for this session.
  }
}

// Re-export the React hook so consumers don't import react-i18next directly,
// keeping a single chokepoint for any future migration.
export { useTranslation };

// `t` is convenient when a hook is overkill (e.g. inside non-React utilities
// or one-off renders). Always defaults to the avatar namespace.
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: I18N_NAMESPACE, ...(options ?? {}) }) as string;
}
