import type { useTranslation } from 'react-i18next';

type TranslationFn = ReturnType<typeof useTranslation>['t'];

// Realm Persona Studio authors owner Persona profiles with closed-set style
// codes (archetype / traits / interactionModes), while world characters author
// localized free text into the same profile fields. Translate exact closed-set
// matches into localized labels and pass any free-text value through unchanged.
const PERSONA_ARCHETYPE_CODES = [
  'CARING',
  'PLAYFUL',
  'INTELLECTUAL',
  'CONFIDENT',
  'MYSTERIOUS',
  'ROMANTIC',
] as const;

const PERSONA_TRAIT_CODES = [
  'HUMOROUS',
  'SARCASTIC',
  'GENTLE',
  'DIRECT',
  'OPTIMISTIC',
  'REALISTIC',
  'DRAMATIC',
  'PASSIONATE',
  'REBELLIOUS',
  'INNOCENT',
  'WISE',
  'ECCENTRIC',
] as const;

const PERSONA_INTERACTION_MODE_CODES = [
  'CONVERSATION',
] as const;

const PERSONA_STYLE_DEFAULT_LABELS: Record<string, string> = {
  CARING: 'Caring',
  PLAYFUL: 'Playful',
  INTELLECTUAL: 'Intellectual',
  CONFIDENT: 'Confident',
  MYSTERIOUS: 'Mysterious',
  ROMANTIC: 'Romantic',
  HUMOROUS: 'Humorous',
  SARCASTIC: 'Sarcastic',
  GENTLE: 'Gentle',
  DIRECT: 'Direct',
  OPTIMISTIC: 'Optimistic',
  REALISTIC: 'Realistic',
  DRAMATIC: 'Dramatic',
  PASSIONATE: 'Passionate',
  REBELLIOUS: 'Rebellious',
  INNOCENT: 'Innocent',
  WISE: 'Wise',
  ECCENTRIC: 'Eccentric',
  CONVERSATION: 'Conversation',
};

function personaStyleKey(code: string): string | null {
  if ((PERSONA_ARCHETYPE_CODES as readonly string[]).includes(code)) {
    return `SourceDetail.worldCharacter.personaStyle.archetype.${code}`;
  }
  if ((PERSONA_TRAIT_CODES as readonly string[]).includes(code)) {
    return `SourceDetail.worldCharacter.personaStyle.trait.${code}`;
  }
  if ((PERSONA_INTERACTION_MODE_CODES as readonly string[]).includes(code)) {
    return `SourceDetail.worldCharacter.personaStyle.interactionMode.${code}`;
  }
  return null;
}

export function personaStyleDisplayText(value: string, t: TranslationFn): string {
  const code = value.trim().toUpperCase();
  const key = code ? personaStyleKey(code) : null;
  if (!key) {
    return value;
  }
  return t(key, { defaultValue: PERSONA_STYLE_DEFAULT_LABELS[code] ?? value });
}
