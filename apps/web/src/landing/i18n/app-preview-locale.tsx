import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LandingLocale } from './locale.js';
import { createPreviewTranslate, type PreviewMessages } from './preview-messages.js';

type PreviewLocale = { locale: LandingLocale; messages: PreviewMessages };
const PreviewLocaleContext = createContext<PreviewLocale | null>(null);

export function AppPreviewLocaleProvider({
  locale,
  messages,
  children,
}: PreviewLocale & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <PreviewLocaleContext value={value}>{children}</PreviewLocaleContext>;
}

export function useAppPreviewLocale() {
  const context = useContext(PreviewLocaleContext);
  if (!context) throw new Error('App preview locale provider is required');
  const { locale, messages } = context;
  return useMemo(
    () => ({
      previewLocale: locale,
      previewLang: locale === 'zh' ? 'zh-CN' : 'en',
      t: createPreviewTranslate(messages),
    }),
    [locale, messages],
  );
}
