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

const RELATIONSHIP_THEMES: Record<string, RelationshipTheme> = {
  kinship: {
    accent: '#2f8a57',
    border: '#9fcbaa',
    softBg: 'rgba(235,248,237,.94)',
    cardBg: 'linear-gradient(135deg, rgba(251,255,250,.98), rgba(235,248,237,.9))',
    ink: '#1f6844',
    dash: '3 3',
  },
  association: {
    accent: '#4f7ed8',
    border: '#9bb9ea',
    softBg: 'rgba(237,244,255,.94)',
    cardBg: 'linear-gradient(135deg, rgba(252,254,255,.98), rgba(238,245,255,.92))',
    ink: '#315fae',
    dash: '3 3',
  },
  status: {
    accent: '#68736f',
    border: '#b8c1bc',
    softBg: 'rgba(243,246,243,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,254,250,.98), rgba(241,244,240,.9))',
    ink: '#535d59',
    dash: '3 4',
  },
  postedToOffice: {
    accent: '#c08317',
    border: '#e1be74',
    softBg: 'rgba(255,247,228,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,253,247,.98), rgba(255,244,221,.92))',
    ink: '#98620f',
    dash: '3 3',
  },
  text: {
    accent: '#7d4ed3',
    border: '#ba9be6',
    softBg: 'rgba(247,240,255,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,252,255,.98), rgba(247,239,255,.92))',
    ink: '#6b3dbf',
    dash: '3 3',
  },
  entry: {
    accent: '#bd7c21',
    border: '#dfb772',
    softBg: 'rgba(255,247,232,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,253,248,.98), rgba(255,243,224,.92))',
    ink: '#9c6014',
    dash: '3 3',
  },
  biogAddress: {
    accent: '#278b87',
    border: '#8bc8c4',
    softBg: 'rgba(233,249,247,.94)',
    cardBg: 'linear-gradient(135deg, rgba(250,255,254,.98), rgba(234,248,246,.92))',
    ink: '#17706c',
    dash: '3 3',
  },
  postedAddress: {
    accent: '#278b87',
    border: '#8bc8c4',
    softBg: 'rgba(233,249,247,.94)',
    cardBg: 'linear-gradient(135deg, rgba(250,255,254,.98), rgba(234,248,246,.92))',
    ink: '#17706c',
    dash: '3 3',
  },
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
  return RELATIONSHIP_THEMES[type] ?? {
    accent: '#8c7742',
    border: '#cdbd8d',
    softBg: 'rgba(249,244,229,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,253,248,.98), rgba(249,244,229,.9))',
    ink: '#76602e',
    dash: '3 4',
  };
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
