import type { useTranslation } from 'react-i18next';
import type { describeCharacterPrimaryAction } from '../explore/character-source-materialization';
import type { SourceDetailData } from './source-detail-model.js';
import { personaStyleDisplayText } from './source-detail-persona-style-labels.js';

type TranslationFn = ReturnType<typeof useTranslation>['t'];

// The hero line is the explicit role as authored (closed-set persona style
// codes are localized). No era, dynasty, courtesy name, or art name is derived
// from the world id, archetype, summary, bio, or topics.
export function worldCharacterHeroDescription(source: SourceDetailData, t: TranslationFn): string | null {
  const role = source.characterProfile.role?.trim();
  return role ? personaStyleDisplayText(role, t) : null;
}

export function worldCharacterPrimaryActionLabel(
  action: ReturnType<typeof describeCharacterPrimaryAction>,
  t: TranslationFn,
): string {
  if (action.action === 'become_partner') {
    return t('SourceDetail.worldCharacter.primaryActionMaterialize', {
      defaultValue: action.label,
    });
  }
  return action.label;
}

export function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}
