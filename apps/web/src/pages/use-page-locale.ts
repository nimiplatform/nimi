import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  applyLocaleToLocation,
  persistLocale,
  resolveInitialLocale,
  resolveLocaleFromUrl,
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

export function initialPublicPageLocale(searchOverride?: string): LandingLocale {
  return resolveInitialLocale({
    storage: browserStorage(),
    search: searchOverride ?? (typeof window === 'undefined' ? '' : window.location.search),
    navigatorLanguage: typeof navigator === 'undefined' ? '' : navigator.language,
    defaultLocale: configuredDefaultLocale(),
  });
}

/**
 * Locale state for public pages: selection persists, and the URL keeps the
 * `lang` parameter in sync across both full loads and client-side Router links.
 */
export function usePublicPageLocale(): [LandingLocale, (locale: LandingLocale) => void] {
  let routerLocation: { pathname: string; search: string; hash: string } | null = null;
  let routerNavigate: ReturnType<typeof useNavigate> | null = null;
  try {
    routerLocation = useLocation();
    routerNavigate = useNavigate();
  } catch {
    // Allow standalone rendering outside a Router wrapper.
  }

  const activeSearch = routerLocation?.search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const urlLocale = resolveLocaleFromUrl(activeSearch);
  const [fallbackLocale, setFallbackLocale] = useState<LandingLocale>(() => initialPublicPageLocale(activeSearch));
  const locale = urlLocale ?? fallbackLocale;

  useEffect(() => {
    if (urlLocale && urlLocale !== fallbackLocale) {
      setFallbackLocale(urlLocale);
    }
  }, [fallbackLocale, urlLocale]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  return [locale, (nextLocale) => {
    persistLocale(nextLocale, browserStorage());
    setFallbackLocale(nextLocale);
    if (routerLocation && routerNavigate) {
      const nextUrl = applyLocaleToLocation(routerLocation, nextLocale);
      routerNavigate(nextUrl, { replace: true, preventScrollReset: true });
      return;
    }
    if (typeof window !== 'undefined') {
      const nextUrl = applyLocaleToLocation(
        { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash },
        nextLocale,
      );
      window.history.replaceState(null, '', nextUrl);
    }
  }];
}
