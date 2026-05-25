import type { i18n as I18nInstance } from 'i18next';

type RuntimeI18nLike = Pick<I18nInstance, 'addResourceBundle'> & {
  language?: string;
  resolvedLanguage?: string;
};

let runtimeI18nBinding: RuntimeI18nLike | null = null;

function normalizeRuntimeI18n(value: unknown): RuntimeI18nLike | null {
  if (value && typeof value === 'object') {
    const candidate = value as RuntimeI18nLike;
    if (typeof candidate.addResourceBundle === 'function') {
      return candidate;
    }
  }
  return null;
}

export function bindRuntimeI18n(instance: RuntimeI18nLike | null | undefined): void {
  runtimeI18nBinding = normalizeRuntimeI18n(instance);
}

export function unbindRuntimeI18n(): void {
  runtimeI18nBinding = null;
}

export type PromptLocale = 'en' | 'zh';

export function getPromptLocale(): PromptLocale {
  const language = runtimeI18nBinding?.language || runtimeI18nBinding?.resolvedLanguage || '';
  return language.startsWith('zh') ? 'zh' : 'en';
}
