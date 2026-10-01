import type { CSSProperties } from 'react';
import type { useTranslation } from 'react-i18next';
import type { WorldCharacter } from './world-detail-types.js';

export const EXPLORER_PANEL_HEIGHT_PX = 1100;

export function panelStyle(): CSSProperties {
  return {
    background: 'var(--nimi-surface-card)',
    border: '1px solid var(--nimi-border-subtle)',
    borderRadius: 'var(--nimi-radius-lg)',
    boxShadow: 'var(--nimi-elevation-base)',
  };
}

export function softPanelStyle(): CSSProperties {
  return {
    background: 'var(--nimi-surface-panel)',
    border: '1px solid var(--nimi-border-subtle)',
    borderRadius: 'var(--nimi-radius-md)',
  };
}

// Identity chips come from the character's explicit display fields and its
// explicit importance.
export function identityTags(character: WorldCharacter, t: ReturnType<typeof useTranslation>['t']): string[] {
  const importance = character.importance === 'PRIMARY'
    ? t('WorldDetail.paper.relationshipExplorer.identity.primary')
    : character.importance === 'SECONDARY'
      ? t('WorldDetail.paper.relationshipExplorer.identity.secondary')
      : t('WorldDetail.paper.relationshipExplorer.identity.background');
  const tags = [
    character.role,
    character.faction,
    character.rank,
    character.location,
    importance,
  ].filter((value): value is string => Boolean(value?.trim()));
  return [...new Set(tags)].slice(0, 4);
}
