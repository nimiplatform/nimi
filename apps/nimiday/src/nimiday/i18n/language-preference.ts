import { useSyncExternalStore } from 'react';
import type { LanguagePreference } from '../domain/types.js';
import { resolveLanguage } from './index.js';

const key = 'nimiday.language';
const changed = 'nimiday-language-changed';

/** Startup-only presentation preference. The loaded profile remains authoritative. */
export function readLanguagePreference(): LanguagePreference {
  try {
    const value = globalThis.localStorage?.getItem(key);
    if (value === 'zh' || value === 'en') return value;
  } catch { /* Storage can be unavailable before the App session is ready. */ }
  return 'auto';
}

export function rememberLanguagePreference(preference: LanguagePreference): void {
  try {
    if (globalThis.localStorage?.getItem(key) === preference) return;
    globalThis.localStorage?.setItem(key, preference);
    globalThis.dispatchEvent?.(new Event(changed));
  } catch { /* A cosmetic startup preference must not block the App. */ }
}

function subscribe(listener: () => void): () => void {
  globalThis.addEventListener?.('languagechange', listener);
  globalThis.addEventListener?.('storage', listener);
  globalThis.addEventListener?.(changed, listener);
  return () => {
    globalThis.removeEventListener?.('languagechange', listener);
    globalThis.removeEventListener?.('storage', listener);
    globalThis.removeEventListener?.(changed, listener);
  };
}

export function useAppLanguage(preference?: LanguagePreference) {
  return useSyncExternalStore(subscribe, () => resolveLanguage(preference ?? readLanguagePreference()));
}
