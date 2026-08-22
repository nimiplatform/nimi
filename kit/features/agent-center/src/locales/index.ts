import { agentCenterEnCatalog } from './en.js';
import { agentCenterZhCatalog } from './zh.js';
import type { AgentCenterI18n } from '../types.js';
import type { AgentCenterCatalog, AgentCenterTranslationKey } from './en.js';

export type AgentCenterSupportedLanguage = 'en' | 'zh';

export const AGENT_CENTER_BASE_LANGUAGE: AgentCenterSupportedLanguage = 'en';

export const agentCenterCatalogs = {
  en: agentCenterEnCatalog,
  zh: agentCenterZhCatalog,
} as const satisfies Readonly<Record<AgentCenterSupportedLanguage, AgentCenterCatalog>>;

export function resolveAgentCenterLanguage(language: string | null | undefined): AgentCenterSupportedLanguage {
  return language?.trim().toLowerCase().startsWith('zh') ? 'zh' : AGENT_CENTER_BASE_LANGUAGE;
}

export function getAgentCenterCatalog(language: string | null | undefined): AgentCenterCatalog {
  return agentCenterCatalogs[resolveAgentCenterLanguage(language)];
}

export function getAgentCenterEnglishMessage(key: string): string | undefined {
  return agentCenterEnCatalog[key as AgentCenterTranslationKey];
}

export function getAgentCenterMessage(
  language: string | null | undefined,
  key: string,
): string | undefined {
  const catalog = getAgentCenterCatalog(language);
  return catalog[key as AgentCenterTranslationKey] ?? getAgentCenterEnglishMessage(key);
}

export function getAgentCenterCatalogRecord(
  prefix: string,
  options: { readonly preserveKeys?: boolean } = {},
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(agentCenterEnCatalog)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [options.preserveKeys ? key : key.slice(prefix.length), value]),
  );
}

function catalogNamespaceResource(
  catalog: AgentCenterCatalog,
  namespace: string,
): Readonly<Record<string, unknown>> {
  const root: Record<string, unknown> = {};
  const prefix = `${namespace}.`;
  for (const [catalogKey, message] of Object.entries(catalog)) {
    if (!catalogKey.startsWith(prefix)) continue;
    const segments = catalogKey.slice(prefix.length).split('.');
    let cursor = root;
    for (const segment of segments.slice(0, -1)) {
      const child = cursor[segment];
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }
    const leaf = segments.at(-1);
    if (leaf) cursor[leaf] = message;
  }
  return root;
}

/** Nested AgentCenter namespace data for hosts that mount Kit copy in their locale runtime. */
export const agentCenterLocaleResources = {
  en: catalogNamespaceResource(agentCenterEnCatalog, 'AgentCenter'),
  zh: catalogNamespaceResource(agentCenterZhCatalog, 'AgentCenter'),
} as const;

/** Creates a host-neutral Kit-backed binding; host overrides still win per key. */
export function createAgentCenterI18n(input: {
  readonly language?: string | null;
  readonly t?: AgentCenterI18n['t'];
  readonly exists?: AgentCenterI18n['exists'];
} = {}): AgentCenterI18n {
  return {
    language: input.language ?? AGENT_CENTER_BASE_LANGUAGE,
    exists(key) {
      return getAgentCenterMessage(input.language, key) !== undefined
        || Boolean(input.exists?.(key));
    },
    t(key, values) {
      const kitMessage = getAgentCenterMessage(input.language, key)
        ?? (typeof values?.defaultValue === 'string' ? values.defaultValue : '');
      if (!input.t) return kitMessage;
      if (input.exists && !input.exists(key)) return kitMessage;
      const translated = input.t(key, { ...values, defaultValue: kitMessage });
      return translated && translated !== key ? translated : kitMessage;
    },
  };
}

export { agentCenterEnCatalog } from './en.js';
export { agentCenterZhCatalog } from './zh.js';
export type { AgentCenterCatalog, AgentCenterTranslationKey } from './en.js';
