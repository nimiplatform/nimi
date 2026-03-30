import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'lookdev.shell.locale';

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  zh: '简体中文',
};

function readStoredLocale(): SupportedLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as SupportedLocale;
    }
  } catch {
    // no-op
  }
  return 'zh';
}

function resolveDocumentLang(locale: SupportedLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

function syncDocumentState(locale: SupportedLocale): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.lang = resolveDocumentLang(locale);
  document.title = locale === 'zh' ? 'Lookdev' : 'Lookdev';
}

async function loadMessages(locale: SupportedLocale): Promise<Record<string, unknown>> {
  switch (locale) {
    case 'en': return (await import('../locales/en.json')).default as Record<string, unknown>;
    case 'zh': return (await import('../locales/zh.json')).default as Record<string, unknown>;
  }
}

const initialLocale = readStoredLocale();

export const i18n = i18next.createInstance();

let initPromise: Promise<void> | null = null;

export async function initI18n(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const messages = await loadMessages(initialLocale);
    await i18n.use(initReactI18next).init({
      lng: initialLocale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        [initialLocale]: { translation: messages },
      },
    });
    syncDocumentState(initialLocale);
  })();

  return initPromise;
}

void initI18n();

export async function changeLocale(locale: SupportedLocale): Promise<void> {
  const hasBundle = (() => {
    try {
      return Boolean(i18n.getResourceBundle(locale, 'translation'));
    } catch {
      return false;
    }
  })();

  if (!hasBundle) {
    const messages = await loadMessages(locale);
    i18n.addResourceBundle(locale, 'translation', messages, true, false);
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
  const language = String(i18n.language || initialLocale).trim();
  if ((SUPPORTED_LOCALES as readonly string[]).includes(language)) {
    return language as SupportedLocale;
  }
  return 'zh';
}

export function getLocaleLabel(locale: SupportedLocale): string {
  return LOCALE_LABELS[locale];
}
