import type { useTranslation } from 'react-i18next';

type TranslationFn = ReturnType<typeof useTranslation>['t'];

// Only show a type label translated for the current language. An untranslated
// identifier is not display text; the authored name and description remain.
export function relationKindLabel(
  type: string,
  t: TranslationFn,
): string | null {
  return t(`SourceDetail.worldCharacter.relationshipKind.${type}`, {
    defaultValue: '',
    fallbackLng: false,
  }) || null;
}

// Some authored topics start with a relationship code. Translate that explicit
// prefix only; prose, names, and unrecognized prefixes remain authored text.
export function characterKnowledgeTopicText(topic: string, t: TranslationFn): string {
  const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*[:：]\s*(.+)$/su.exec(topic);
  if (!match) return topic;
  const label = relationKindLabel(match[1]!, t);
  return label ? t('SourceDetail.worldCharacter.knowledgeTopic', { label, text: match[2]! }) : topic;
}
