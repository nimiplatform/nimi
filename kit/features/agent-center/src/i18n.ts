import { getAgentCenterMessage } from './locales/index.js';
import type { AgentCenterI18n } from './types.js';

export type AgentCenterTranslationValues = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

export function formatAgentCenterMessage(
  template: string,
  values: AgentCenterTranslationValues = {},
): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? '') : match
  ));
}

export function translateAgentCenter(
  i18n: AgentCenterI18n | undefined,
  key: string,
  defaultValue: string,
  values: AgentCenterTranslationValues = {},
): string {
  if (!i18n) return formatAgentCenterMessage(defaultValue, values);
  const baseMessage = getAgentCenterMessage('en', key) ?? defaultValue;
  const activeMessage = getAgentCenterMessage(i18n.language, key) ?? baseMessage;
  const translated = i18n.t(key, { ...values, defaultValue: activeMessage });
  if (!translated || translated === key) return formatAgentCenterMessage(activeMessage, values);
  return formatAgentCenterMessage(translated, values);
}
