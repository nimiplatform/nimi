import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { ArrowRight, CirclePlus } from 'lucide-react';
import { describeCharacterPrimaryAction } from '../explore/character-source-materialization.js';
import type { SourceDetailData } from './source-detail-model.js';
import { worldCharacterPrimaryActionLabel } from './source-detail-world-character-labels.js';

export type CharacterPartnerActions = {
  onPrimaryAction: () => void;
  onCreateAnother?: () => void;
  partners?: { localAgentRef: string; displayName: string; capturedAt?: string }[];
  onSelectPartner?: (localAgentRef: string) => void;
  primaryActionJoining?: boolean;
};

export function CharacterActions({ source, onOpenWorld, ...props }: CharacterPartnerActions & {
  source: SourceDetailData;
  onOpenWorld: () => void;
}) {
  const { t } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const action = describeCharacterPrimaryAction(source.sourceState, t);
  const partners = props.partners ?? [];
  const openExisting = action.action === 'open_partner';
  const ambiguous = action.action === 'partner_ambiguous';
  const busy = props.primaryActionJoining === true;
  return <div className="flex min-w-0 flex-col items-end gap-3 max-[720px]:items-start">
    <div data-testid="world-character-hero-actions" className="flex flex-wrap items-center justify-end gap-3 max-[720px]:justify-start">
      {source.worldId && !source.worldName ? <Button tone="secondary" onClick={onOpenWorld}>{t('SourceDetail.openWorld')}</Button> : null}
      {ambiguous ? <Popover open={choosing} onOpenChange={setChoosing}>
        <PopoverTrigger asChild>
          <Button data-testid="character-choose-partner" tone="primary" size="lg" className="min-w-44 justify-between rounded-full px-6"
            disabled={busy || !props.onSelectPartner || partners.length < 2}>
            {t('SourceDetail.choosePartner')}<ArrowRight aria-hidden className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-[min(360px,calc(100vw-40px))] p-2">
          <p className="px-3 py-2 text-sm font-semibold text-[var(--nimi-text-primary)]">{t('SourceDetail.choosePartner')}</p>
          <div className="grid max-h-72 gap-1 overflow-y-auto">
            {partners.map(partner => <button key={partner.localAgentRef} type="button" disabled={busy}
              onClick={() => { setChoosing(false); props.onSelectPartner?.(partner.localAgentRef); }}
              className="rounded-lg px-3 py-2.5 text-left hover:bg-[var(--nimi-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
              <span className="block text-sm font-medium text-[var(--nimi-text-primary)]">{partner.displayName}</span>
              <span className="mt-1 block text-xs text-[var(--nimi-text-secondary)]">{partner.capturedAt
                ? t('SourceDetail.partnerCreatedAt', { date: new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(partner.capturedAt)) })
                : t('SourceDetail.partnerCreationUnknown')}</span>
            </button>)}
          </div>
        </PopoverContent>
      </Popover> : <Button tone="primary" size="lg" onClick={props.onPrimaryAction}
        disabled={busy || (!openExisting && action.disabled)}
        className={openExisting ? 'min-w-44 justify-between rounded-full px-6' : 'justify-center gap-2 rounded-full px-5'}
        data-source-state={source.sourceState} data-primary-action={action.action}>
        {openExisting ? null : <CirclePlus aria-hidden className="h-4 w-4" />}
        {openExisting ? t('Explore.characterSourceOpenLocalAgent') : busy
          ? t('SourceDetail.worldCharacter.primaryActionJoining') : worldCharacterPrimaryActionLabel(action, t)}
        {openExisting ? <ArrowRight aria-hidden className="h-4 w-4" /> : null}
      </Button>}
    </div>
    {action.state === 'source_materialization_unavailable' ? <p role="status" className="max-w-sm text-sm text-[var(--nimi-text-secondary)]">{action.hint}</p> : null}
    {partners.length || props.onCreateAnother ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--nimi-text-secondary)]">
      {partners.length ? <span>{t('SourceDetail.worldCharacter.partnerCount', { count: partners.length })}</span> : null}
      {props.onCreateAnother ? <Popover open={creating} onOpenChange={setCreating}>
        <PopoverTrigger asChild><button type="button" disabled={busy}
          className="rounded text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
          {t('runtimeConfig.partners.createAnother')}
        </button></PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-[min(340px,calc(100vw-40px))]">
          <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{t('runtimeConfig.partners.createAnotherHelp')}</p>
          <Button tone="secondary" size="sm" className="mt-3" disabled={busy}
            onClick={() => { setCreating(false); props.onCreateAnother?.(); }}>{t('runtimeConfig.partners.confirmCreate')}</Button>
        </PopoverContent>
      </Popover> : null}
    </div> : null}
  </div>;
}
