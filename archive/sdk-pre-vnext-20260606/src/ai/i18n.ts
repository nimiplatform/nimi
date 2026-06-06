import type { i18n as I18nInstance } from 'i18next';

type SdkI18nLike = Pick<I18nInstance, 'addResourceBundle'> & {
  language?: string;
  resolvedLanguage?: string;
};

let sdkI18nBinding: SdkI18nLike | null = null;

function normalizeSdkI18n(value: unknown): SdkI18nLike | null {
  if (value && typeof value === 'object') {
    const candidate = value as SdkI18nLike;
    if (typeof candidate.addResourceBundle === 'function') {
      return candidate;
    }
  }
  return null;
}

export function bindSdkI18n(instance: SdkI18nLike | null | undefined): void {
  sdkI18nBinding = normalizeSdkI18n(instance);
}

export function unbindSdkI18n(): void {
  sdkI18nBinding = null;
}

export type PromptLocale = 'en' | 'zh';

export function getPromptLocale(): PromptLocale {
  const language = sdkI18nBinding?.language || sdkI18nBinding?.resolvedLanguage || '';
  return language.startsWith('zh') ? 'zh' : 'en';
}
