import type { useTranslation } from 'react-i18next';

type TranslationFn = ReturnType<typeof useTranslation>['t'];

// Translate each explicit type without collapsing its meaning into a generic
// category. New authored types remain visible until their translation is added.
export function relationKindLabel(
  type: string,
  t: TranslationFn,
): string {
  return t(`SourceDetail.worldCharacter.relationshipKind.${type}`, { defaultValue: type });
}
