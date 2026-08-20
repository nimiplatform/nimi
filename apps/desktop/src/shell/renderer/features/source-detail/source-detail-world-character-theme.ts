import type { useTranslation } from 'react-i18next';
import type { SourceDetailWorldCharacterMilestone } from './source-detail-model.js';

type TranslationFn = ReturnType<typeof useTranslation>['t'];

export type RelationshipTheme = {
  accent: string;
  border: string;
  softBg: string;
  cardBg: string;
  ink: string;
  dash: string;
};

const STATUS_THEME_TOKENS = {
  success: {
    accent: 'var(--nimi-status-success)',
    border: 'var(--nimi-status-success-soft-border)',
    softBg: 'var(--nimi-status-success-soft-bg)',
    ink: 'var(--nimi-status-success-soft-text)',
  },
  info: {
    accent: 'var(--nimi-status-info)',
    border: 'var(--nimi-status-info-soft-border)',
    softBg: 'var(--nimi-status-info-soft-bg)',
    ink: 'var(--nimi-status-info-soft-text)',
  },
  neutral: {
    accent: 'var(--nimi-status-neutral)',
    border: 'var(--nimi-status-neutral-soft-border)',
    softBg: 'var(--nimi-status-neutral-soft-bg)',
    ink: 'var(--nimi-status-neutral-soft-text)',
  },
  warning: {
    accent: 'var(--nimi-status-warning)',
    border: 'var(--nimi-status-warning-soft-border)',
    softBg: 'var(--nimi-status-warning-soft-bg)',
    ink: 'var(--nimi-status-warning-soft-text)',
  },
  danger: {
    accent: 'var(--nimi-status-danger)',
    border: 'var(--nimi-status-danger-soft-border)',
    softBg: 'var(--nimi-status-danger-soft-bg)',
    ink: 'var(--nimi-status-danger-soft-text)',
  },
  indigo: {
    accent: 'var(--nimi-color-indigo)',
    border: 'color-mix(in srgb, var(--nimi-color-indigo) 26%, transparent)',
    softBg: 'color-mix(in srgb, var(--nimi-color-indigo) 14%, transparent)',
    ink: 'var(--nimi-color-indigo)',
  },
  primary: {
    accent: 'var(--nimi-action-primary-bg)',
    border: 'color-mix(in srgb, var(--nimi-action-primary-bg) 26%, transparent)',
    softBg: 'color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent)',
    ink: 'var(--nimi-action-primary-bg)',
  },
} as const;

type StatusThemeTokenSet = (typeof STATUS_THEME_TOKENS)[keyof typeof STATUS_THEME_TOKENS];

function relationshipThemeFrom(tokens: StatusThemeTokenSet, dash: string): RelationshipTheme {
  return {
    ...tokens,
    cardBg: `linear-gradient(135deg, var(--nimi-surface-card), ${tokens.softBg})`,
    dash,
  };
}

const RELATIONSHIP_THEMES: Record<string, RelationshipTheme> = {
  kinship: relationshipThemeFrom(STATUS_THEME_TOKENS.success, '3 3'),
  association: relationshipThemeFrom(STATUS_THEME_TOKENS.info, '3 3'),
  status: relationshipThemeFrom(STATUS_THEME_TOKENS.neutral, '3 4'),
  postedToOffice: relationshipThemeFrom(STATUS_THEME_TOKENS.warning, '3 3'),
  text: relationshipThemeFrom(STATUS_THEME_TOKENS.indigo, '3 3'),
  entry: relationshipThemeFrom(STATUS_THEME_TOKENS.danger, '3 3'),
  biogAddress: relationshipThemeFrom(STATUS_THEME_TOKENS.primary, '3 3'),
  postedAddress: relationshipThemeFrom(STATUS_THEME_TOKENS.primary, '3 3'),
};

export function relationKindLabel(
  type: string,
  t: TranslationFn,
): string {
  const labels: Record<string, string> = {
    status: t('SourceDetail.worldCharacter.relationshipKind.status', { defaultValue: 'Status' }),
    postedToOffice: t('SourceDetail.worldCharacter.relationshipKind.office', { defaultValue: 'Office' }),
    association: t('SourceDetail.worldCharacter.relationshipKind.association', { defaultValue: 'Association' }),
    text: t('SourceDetail.worldCharacter.relationshipKind.text', { defaultValue: 'Text' }),
    entry: t('SourceDetail.worldCharacter.relationshipKind.entry', { defaultValue: 'Entry' }),
    biogAddress: t('SourceDetail.worldCharacter.relationshipKind.place', { defaultValue: 'Place' }),
    postedAddress: t('SourceDetail.worldCharacter.relationshipKind.postedPlace', { defaultValue: 'Posted place' }),
  };
  return labels[type] ?? type;
}

export function relationshipTheme(type: string): RelationshipTheme {
  return RELATIONSHIP_THEMES[type] ?? relationshipThemeFrom(STATUS_THEME_TOKENS.neutral, '3 4');
}

/** Theme for the "all relationships" filter, keyed to the primary accent. */
export function allRelationshipsTheme(): RelationshipTheme {
  return relationshipThemeFrom(STATUS_THEME_TOKENS.primary, '3 4');
}

export function milestoneKindLabel(
  milestone: SourceDetailWorldCharacterMilestone,
  t: TranslationFn,
): string {
  if (milestone.kind === 'office') {
    return relationKindLabel('postedToOffice', t);
  }
  if (milestone.kind === 'work') {
    return relationKindLabel('text', t);
  }
  if (milestone.kind === 'entry') {
    return relationKindLabel('entry', t);
  }
  return t('SourceDetail.worldCharacter.milestoneKind.biography', { defaultValue: 'Biography' });
}

export function milestoneTheme(milestone: SourceDetailWorldCharacterMilestone): RelationshipTheme {
  if (milestone.kind === 'office') {
    return relationshipTheme('postedToOffice');
  }
  if (milestone.kind === 'work') {
    return relationshipTheme('text');
  }
  if (milestone.kind === 'entry') {
    return relationshipTheme('entry');
  }
  return relationshipTheme('kinship');
}
