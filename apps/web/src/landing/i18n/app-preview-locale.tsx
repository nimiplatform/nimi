import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LandingLocale } from './locale.js';

export type PreviewMessages = Readonly<Record<string, string>>;
type PreviewLocale = { locale: LandingLocale; messages: PreviewMessages };
const PreviewLocaleContext = createContext<PreviewLocale>({ locale: 'zh', messages: {} });
const templateCache = new WeakMap<
  PreviewMessages,
  ReadonlyArray<{ pattern: RegExp; target: string }>
>();

function messageTemplates(messages: PreviewMessages) {
  const cached = templateCache.get(messages);
  if (cached) return cached;
  const templates = Object.entries(messages)
    // Adjacent values have no parseable boundary; render them with pFormat.
    .filter(([source]) => /\{\d+\}/u.test(source) && !/\{\d+\}\{\d+\}/u.test(source))
    .sort(([a], [b]) => b.replace(/\{\d+\}/gu, '').length - a.replace(/\{\d+\}/gu, '').length)
    .map(([source, target]) => ({
      pattern: new RegExp(
        '^' +
          source
            .split(/\{\d+\}/u)
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
            .join('([\\s\\S]*?)') +
          '$',
        'u',
      ),
      target,
    }));
  templateCache.set(messages, templates);
  return templates;
}

/** Translate authored copy only. Editable samples are localized before entering state. */
export function translatePreviewText(text: string, messages: PreviewMessages): string {
  if (Object.hasOwn(messages, text)) return messages[text]!;
  const trimmed = text.trim();
  if (Object.hasOwn(messages, trimmed)) return text.replace(trimmed, messages[trimmed]!);
  for (const { pattern, target } of messageTemplates(messages)) {
    const match = pattern.exec(text);
    if (match)
      return target.replace(/\{(\d+)\}/gu, (_, index: string) =>
        translatePreviewText(match[Number(index) + 1] ?? '', messages),
      );
  }
  return text;
}

/** Localize an authored label while keeping its supplied values verbatim. */
export function formatPreviewText(
  pattern: string,
  values: readonly (string | number)[],
  messages: PreviewMessages,
): string {
  return (messages[pattern] ?? pattern).replace(/\{(\d+)\}/gu, (_, index: string) =>
    String(values[Number(index)] ?? ''),
  );
}

function translateNode<T>(value: T, messages: PreviewMessages): T {
  if (typeof value === 'string') return translatePreviewText(value, messages) as T;
  if (Array.isArray(value)) return value.map((entry) => translateNode(entry, messages)) as T;
  return value;
}

/** Translate authored display data and seeds; never apply this to visitor-edited state. */
export function translatePreviewData<T>(value: T, messages: PreviewMessages): T {
  if (typeof value === 'string') return translatePreviewText(value, messages) as T;
  if (Array.isArray(value)) return value.map((entry) => translatePreviewData(entry, messages)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        // Chart grades and elements are semantic values used by styling/lookup.
        // Their visible labels are translated at the owning render sites.
        ['mutagen', 'brightness', 'strength', 'element'].includes(key)
          ? entry
          : translatePreviewData(entry, messages),
      ]),
    ) as T;
  }
  return value;
}

export function AppPreviewLocaleProvider({
  locale,
  messages,
  children,
}: PreviewLocale & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <PreviewLocaleContext value={value}>{children}</PreviewLocaleContext>;
}

export function useAppPreviewLocale() {
  const { locale, messages } = useContext(PreviewLocaleContext);
  return useMemo(
    () => ({
      previewLocale: locale,
      previewLang: locale === 'zh' ? 'zh-CN' : 'en',
      pText: <T,>(value: T): T => translateNode(value, messages),
      pData: <T,>(value: T): T => translatePreviewData(value, messages),
      pFormat: (pattern: string, ...values: (string | number)[]): string =>
        formatPreviewText(pattern, values, messages),
    }),
    [locale, messages],
  );
}
