import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import { ArrowRight, CirclePlus } from 'lucide-react';
import { describeCharacterPrimaryAction } from '../explore/character-source-materialization.js';
import type { SourceDetailData } from './source-detail-model.js';
import { worldCharacterPrimaryActionLabel } from './source-detail-world-character-labels.js';

export type CharacterPartnerActions = {
  onPrimaryAction: () => void;
  primaryActionJoining?: boolean;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r006
export function CharacterActions({ source, onOpenWorld, compact = false, ...props }: CharacterPartnerActions & {
  source: SourceDetailData;
  onOpenWorld: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const action = describeCharacterPrimaryAction(source.sourceState, t);
  const openExisting = action.action === 'open_partner';
  const busy = props.primaryActionJoining === true;
  const label = openExisting
    ? t('Explore.characterSourceOpenLocalAgent')
    : busy
      ? t('SourceDetail.worldCharacter.primaryActionJoining')
      : worldCharacterPrimaryActionLabel(action, t);

  if (compact) {
    return (
      <Button
        tone="primary"
        size="sm"
        onClick={props.onPrimaryAction}
        disabled={busy || action.disabled}
        className="shrink-0 justify-center gap-1.5 px-4"
        data-source-state={source.sourceState}
        data-primary-action={action.action}
      >
        {openExisting ? null : <CirclePlus aria-hidden className="h-3.5 w-3.5" />}
        {label}
        {openExisting ? <ArrowRight aria-hidden className="h-3.5 w-3.5" /> : null}
      </Button>
    );
  }

  return <div className="flex min-w-0 shrink-0 flex-col items-end gap-2 max-[760px]:items-start">
    <div data-testid="world-character-hero-actions" className="flex flex-wrap items-center justify-end gap-2.5 max-[760px]:justify-start">
      {source.worldId && !source.worldName ? <Button tone="secondary" onClick={onOpenWorld}>{t('SourceDetail.openWorld')}</Button> : null}
      <Button tone="primary" size="lg" onClick={props.onPrimaryAction}
        disabled={busy || action.disabled}
        className={openExisting ? 'justify-center px-5' : 'justify-center gap-2 px-5'}
        data-source-state={source.sourceState} data-primary-action={action.action}>
        {openExisting ? null : <CirclePlus aria-hidden className="h-4 w-4" />}
        {label}
        {openExisting ? <ArrowRight aria-hidden className="h-4 w-4" /> : null}
      </Button>
    </div>
    {action.hint ? <p role="status" className="max-w-xs text-right text-xs leading-5 text-[var(--nimi-text-muted)] max-[760px]:text-left">{action.hint}</p> : null}
  </div>;
}
