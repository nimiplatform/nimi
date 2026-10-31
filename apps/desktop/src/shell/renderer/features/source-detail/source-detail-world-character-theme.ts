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
