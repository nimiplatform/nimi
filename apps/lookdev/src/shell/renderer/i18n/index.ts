import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@renderer/locales/en.json';
import zh from '@renderer/locales/zh.json';

export const i18n = i18next.createInstance();

void i18n
  .use(initReactI18next)
  .init({
    lng: 'zh',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
  });
