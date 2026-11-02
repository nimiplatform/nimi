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
export function CharacterActions({ source, onOpenWorld, ...props }: CharacterPartnerActions & {
  source: SourceDetailData;
  onOpenWorld: () => void;
}) {
  const { t } = useTranslation();
  const action = describeCharacterPrimaryAction(source.sourceState, t);
  const openExisting = action.action === 'open_partner';
  const busy = props.primaryActionJoining === true;
  return <div className="flex min-w-0 flex-col items-end gap-3 max-[720px]:items-start">
    <div data-testid="world-character-hero-actions" className="flex flex-wrap items-center justify-end gap-3 max-[720px]:justify-start">
      {source.worldId && !source.worldName ? <Button tone="secondary" onClick={onOpenWorld}>{t('SourceDetail.openWorld')}</Button> : null}
      <Button tone="primary" size="lg" onClick={props.onPrimaryAction}
        disabled={busy || action.disabled}
        className={openExisting ? 'justify-center rounded-full px-5' : 'justify-center gap-2 rounded-full px-5'}
        data-source-state={source.sourceState} data-primary-action={action.action}>
        {openExisting ? null : <CirclePlus aria-hidden className="h-4 w-4" />}
        {openExisting ? t('Explore.characterSourceOpenLocalAgent') : busy
          ? t('SourceDetail.worldCharacter.primaryActionJoining') : worldCharacterPrimaryActionLabel(action, t)}
        {openExisting ? <ArrowRight aria-hidden className="h-4 w-4" /> : null}
      </Button>
    </div>
    {action.hint ? <p role="status" className="max-w-sm text-sm text-[var(--nimi-text-secondary)]">{action.hint}</p> : null}
  </div>;
}
