import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: {
        Auth: {
          clickToAuthorize: 'Click to authorize in browser',
          desktopAuthFailed: 'Authorization failed. Click logo to retry.',
          currentAccount: 'Current account',
          authorizeDesktopButton: 'Authorize desktop',
          useAnotherAccount: 'Use another account',
          nimiNetwork: 'NIMI PLATFORM',
          authorizing: 'Authorizing...',
        },
      },
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  initImmediate: false,
  interpolation: {
    escapeValue: false,
  },
});

export { i18n };
