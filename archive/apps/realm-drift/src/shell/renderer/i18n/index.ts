import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@renderer/locales/en.json';
import zh from '@renderer/locales/zh.json';

const resources = {
  en: { translation: en },
  zh: { translation: zh },
};

function detectLanguage(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    if (navigator.language.startsWith('zh')) return 'zh';
  }
  return 'en';
}

export async function initI18n(language?: string): Promise<void> {
  const detectedLanguage = language || detectLanguage();
  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: detectedLanguage,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
    });
}

export function changeLocale(locale: string): void {
  void i18n.changeLanguage(locale);
}

export { i18n };
