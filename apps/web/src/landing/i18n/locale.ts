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

export function resolveInitialLocale(input: {
  storage?: StorageLike | null;
  navigatorLanguage?: unknown;
  defaultLocale?: unknown;
}): LandingLocale {
  const fallbackLocale = resolveDefaultLocale(input.defaultLocale);
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
