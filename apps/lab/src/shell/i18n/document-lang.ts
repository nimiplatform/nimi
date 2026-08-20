// Document-language synchronization for the lab i18n module.
// Kept out of i18n/index.ts because that module is reachable from the
// simulator adapter closure, which forbids document/window access. Only
// renderer entry points (main.tsx, dev-preview.tsx) import this installer.

import { getCurrentLocale, i18n, toDocumentLang } from './index.js';

export function installDocumentLangSync(): void {
  document.documentElement.lang = toDocumentLang(getCurrentLocale());
  i18n.on('languageChanged', () => {
    document.documentElement.lang = toDocumentLang(getCurrentLocale());
  });
}
