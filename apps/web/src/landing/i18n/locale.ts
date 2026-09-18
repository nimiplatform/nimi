export type LandingLocale = 'en' | 'zh';

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export const LANDING_LOCALE_STORAGE_KEY = 'nimi.landing.locale';

export function normalizeLocale(raw: unknown): LandingLocale | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'en' || value === 'zh') {
    return value;
  }
  return null;
}

export function detectBrowserLocale(language: unknown): LandingLocale | null {
  const value = typeof language === 'string' ? language.trim().toLowerCase() : '';
  if (!value) {
    return null;
  }
  if (value.startsWith('zh')) {
    return 'zh';
  }
  if (value.startsWith('en')) {
    return 'en';
  }
  return null;
}

export function resolveDefaultLocale(rawDefault: unknown): LandingLocale {
  return normalizeLocale(rawDefault) ?? 'en';
}

export function resolveLocaleFromUrl(search: unknown): LandingLocale | null {
  const value = typeof search === 'string' ? search.trim() : '';
  if (!value) {
    return null;
  }

  const query = value.startsWith('?') ? value.slice(1) : value;
  const params = new URLSearchParams(query);
  return normalizeLocale(params.get('lang')) ?? normalizeLocale(params.get('locale'));
}

export function resolveInitialLocale(input: {
  search?: unknown;
  storage?: StorageLike | null;
  navigatorLanguage?: unknown;
  defaultLocale?: unknown;
}): LandingLocale {
  const fallbackLocale = resolveDefaultLocale(input.defaultLocale);
  const urlLocale = resolveLocaleFromUrl(input.search);
  if (urlLocale) {
    return urlLocale;
  }

  const storedLocale = input.storage
    ? normalizeLocale(input.storage.getItem(LANDING_LOCALE_STORAGE_KEY))
    : null;
  if (storedLocale) {
    return storedLocale;
  }

  const browserLocale = detectBrowserLocale(input.navigatorLanguage);
  return browserLocale ?? fallbackLocale;
}

export function persistLocale(locale: LandingLocale, storage?: StorageLike | null): void {
  if (!storage) {
    return;
  }
  storage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
}

/**
 * Return the query string for a locale switch while preserving unrelated
 * parameters, so a shared URL keeps pointing at the language actually shown.
 */
export function buildLocaleSearch(search: string, locale: LandingLocale): string {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  params.set('lang', locale);
  return params.toString();
}

/**
 * Build the full path after a locale switch, preserving the current route,
 * other query parameters, and the location hash.
 */
export function applyLocaleToLocation(
  location: { pathname: string; search: string; hash: string },
  locale: LandingLocale,
): string {
  const search = buildLocaleSearch(location.search, locale);
  return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
}
