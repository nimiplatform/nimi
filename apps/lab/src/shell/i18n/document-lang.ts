// Document-language synchronization for the lab i18n module.
// Kept out of i18n/index.ts because that module is reachable from the
// non-DOM localization modules. Only
// renderer entry points (main.tsx, dev-preview.tsx) import this installer.

import { getCurrentLocale, i18n, toDocumentLang } from './index.js';

export function installDocumentLangSync(): () => void {
  const syncDocumentLang = () => {
    document.documentElement.lang = toDocumentLang(getCurrentLocale());
  };
  syncDocumentLang();
  i18n.on('languageChanged', syncDocumentLang);
  return () => { i18n.off('languageChanged', syncDocumentLang); };
}
