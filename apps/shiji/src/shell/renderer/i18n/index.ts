import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from '@renderer/locales/zh.json';
import en from '@renderer/locales/en.json';

const resources = {
  zh: { translation: zh },
  en: { translation: en },
};

// ShiJi is a Chinese history education app — default to zh
const detectedLanguage = navigator.language?.startsWith('zh') ? 'zh' : 'en';

// Eager init — resources are statically bundled so init is synchronous.
// Must happen before React renders to avoid Suspense on useTranslation().
void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: detectedLanguage,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
  });

export async function initI18n(language?: string): Promise<void> {
  if (language && language !== i18n.language) {
    await i18n.changeLanguage(language);
  }
}

export function changeLocale(locale: string): void {
  void i18n.changeLanguage(locale);
}

export { i18n };
