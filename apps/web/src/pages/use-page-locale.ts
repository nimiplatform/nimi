import { useEffect, useState } from 'react';
import {
  applyLocaleToLocation,
  persistLocale,
  resolveInitialLocale,
  type LandingLocale,
  type StorageLike,
} from '../landing/i18n/locale.js';

function browserStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

// `import.meta.env` is provided by Vite at build time, but is undefined when
// these pages are rendered directly under Node (for example in tests).
function configuredDefaultLocale(): string | undefined {
  return typeof import.meta.env === 'object' && import.meta.env !== null
    ? import.meta.env.VITE_LANDING_DEFAULT_LOCALE
    : undefined;
}

export function initialPublicPageLocale(): LandingLocale {
  return resolveInitialLocale({
    storage: browserStorage(),
    search: typeof window === 'undefined' ? '' : window.location.search,
    navigatorLanguage: typeof navigator === 'undefined' ? '' : navigator.language,
    defaultLocale: configuredDefaultLocale(),
  });
}

/**
 * Locale state for public pages: selection persists, and the URL keeps the
 * `lang` parameter in sync so a shared link shows the language it names.
 */
export function usePublicPageLocale(): [LandingLocale, (locale: LandingLocale) => void] {
  const [locale, setLocale] = useState<LandingLocale>(initialPublicPageLocale);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  return [locale, (nextLocale) => {
    if (typeof window !== 'undefined') {
      const nextUrl = applyLocaleToLocation(
        { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash },
        nextLocale,
      );
      window.history.replaceState(null, '', nextUrl);
    }
    persistLocale(nextLocale, browserStorage());
    setLocale(nextLocale);
  }];
}
