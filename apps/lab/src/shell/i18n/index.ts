// Lab i18n bootstrap.
// Synchronously initializes i18next + react-i18next with the resolved locale's
// resource bundle BEFORE React mount, so every t() call from the very first
// render is a real translation (no async fallback, no flash of English).
//
// Locale resolution order:
//   1. Kit browser storage key `nimi.lab.locale` (persisted user choice)
//   2. navigator.language → first matching SUPPORTED_LOCALES prefix
//   3. 'en'
//
// Resource bundles are assembled from `locales/<locale>/*.json`: each file
// contributes its top-level section object (e.g. studio.json →
// { "Studio": { ... } }). Imports are explicit (no import.meta.glob) because
// register new
// section files in the lists below.

import i18nextCore from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import {
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';

import enAppAccess from './locales/en/app-access.json' with { type: 'json' };
import enAuth from './locales/en/auth.json' with { type: 'json' };
import enCommon from './locales/en/common.json' with { type: 'json' };
import enModelConfig from './locales/en/model-config.json' with { type: 'json' };
import enSettings from './locales/en/settings.json' with { type: 'json' };
import enWorkbenchTop from './locales/en/workbench-top.json' with { type: 'json' };
import enWorkbench from './locales/en/workbench.json' with { type: 'json' };
import {
  aiStudioCoreMessageBundles,
  mergeAIStudioMessageBundles,
} from '../../ai-studio-core/messages/index.js';
import { studioCreateMessageBundles } from '../../studio-modules/studio-create/messages/index.js';
import { studioMediaMessageBundles } from '../../studio-modules/studio-media/messages/index.js';
import { studioVoiceMessageBundles } from '../../studio-modules/studio-voice/messages/index.js';

import zhAppAccess from './locales/zh/app-access.json' with { type: 'json' };
import zhAuth from './locales/zh/auth.json' with { type: 'json' };
import zhCommon from './locales/zh/common.json' with { type: 'json' };
import zhModelConfig from './locales/zh/model-config.json' with { type: 'json' };
import zhSettings from './locales/zh/settings.json' with { type: 'json' };
import zhWorkbenchTop from './locales/zh/workbench-top.json' with { type: 'json' };
import zhWorkbench from './locales/zh/workbench.json' with { type: 'json' };

export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'nimi.lab.locale';
export const I18N_NAMESPACE = 'translation';

const RESOURCES: Record<SupportedLocale, Record<string, unknown>> = {
  en: mergeAIStudioMessageBundles([
    aiStudioCoreMessageBundles.en,
    studioCreateMessageBundles.en,
    studioMediaMessageBundles.en,
    studioVoiceMessageBundles.en,
    enAppAccess,
    enAuth,
    enCommon,
    enModelConfig,
    enSettings,
    enWorkbenchTop,
    enWorkbench,
  ]),
  zh: mergeAIStudioMessageBundles([
    aiStudioCoreMessageBundles.zh,
    studioCreateMessageBundles.zh,
    studioMediaMessageBundles.zh,
    studioVoiceMessageBundles.zh,
    zhAppAccess,
    zhAuth,
    zhCommon,
    zhModelConfig,
    zhSettings,
    zhWorkbenchTop,
    zhWorkbench,
  ]),
};

function detectInitialLocale(): SupportedLocale {
  const stored = readStorageTextFrom(resolveBrowserStorage('local'), LOCALE_STORAGE_KEY);
  if (stored.state === 'ready' && (SUPPORTED_LOCALES as readonly string[]).includes(stored.value)) {
    return stored.value as SupportedLocale;
  }

  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('en')) return 'en';
  }
  return 'en';
}

const initialLocale = detectInitialLocale();

// (pure modules like lab-non-success.ts import t()), so it must not touch
// document/window, declare module-scope let/var state, or call module-scope
// resource factories (create*). It therefore binds the shared default
// i18next instance instead of owning one — the locale catalog is immutable
// after init and language is app-global UI state, which keeps this safe
// across renderer instances. document.lang synchronization lives in
// ./document-lang.ts, which only entry points import.
// Synchronous init — resources are bundled, so no await needed before mount.
void i18nextCore.use(initReactI18next).init({
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

export const i18n = i18nextCore;

export function getCurrentLocale(): SupportedLocale {
  const lng = i18n.language;
  if (lng && (SUPPORTED_LOCALES as readonly string[]).includes(lng)) {
    return lng as SupportedLocale;
  }
  return 'en';
}

export function toDocumentLang(locale: SupportedLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

export async function changeLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  writeStorageTextTo(resolveBrowserStorage('local'), LOCALE_STORAGE_KEY, locale);
}

// Re-export the React hook so consumers don't import react-i18next directly,
// keeping a single chokepoint for any future migration.
export { useTranslation };

// `t` is convenient when a hook is overkill (e.g. inside non-React utilities
// or one-off renders). Always defaults to the lab namespace.
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: I18N_NAMESPACE, ...(options ?? {}) }) as string;
}
