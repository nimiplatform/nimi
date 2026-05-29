import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          Auth: {
            nimiNetwork: 'Nimi Runtime',
            clickToAuthorize: 'Authorize with Runtime',
            desktopAuthFailed: 'Authorization failed. Click the logo to retry.',
          },
        },
      },
    },
    interpolation: { escapeValue: false },
  });
}
