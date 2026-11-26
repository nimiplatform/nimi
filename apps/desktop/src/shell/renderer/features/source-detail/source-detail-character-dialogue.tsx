import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import type { SourceDetailData } from './source-detail-model.js';
import { CharacterProfileText } from './source-detail-character-content.js';

export function CharacterDialogue({ source, includeGreeting = true, showTitle = false, separated = false }: {
  source: SourceDetailData;
  includeGreeting?: boolean;
  showTitle?: boolean;
  separated?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const exemplars = source.characterProfile.dialogueExemplars ?? [];
  const greeting = includeGreeting ? source.characterProfile.interaction?.greeting?.trim() : null;
  const greetingSample = greeting && !exemplars.some(sample => !sample.user && sample.character === greeting)
    ? { id: 'greeting', user: null, character: greeting, label: t('SourceDetail.worldCharacter.greetingTab') } : null;
  const samples = [
    ...(greetingSample ? [greetingSample] : []),
    ...exemplars.map((sample, ordinal) => ({ ...sample,
      // Dialogue exemplars have no scene title. Do not infer one from ids or prose.
      label: t('SourceDetail.worldCharacter.dialogueNumber', { number: ordinal + 1 }),
    })),
  ];
  const [index, setIndex] = useState(greetingSample && exemplars.length ? 1 : 0);
  const selected = index < samples.length ? index : 0;
  const sample = samples[selected];
  if (!sample) return null;
  return <section
    data-testid="world-character-dialogue-section"
    className={`min-w-0 ${separated ? 'border-t border-[var(--nimi-border-subtle)] pt-6' : ''}`}
  >
    {showTitle || samples.length > 1 ? (
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[var(--nimi-border-subtle)]">
        {showTitle ? <h2 className="pb-2.5 text-base font-semibold tracking-[-0.01em] text-[var(--nimi-text-primary)]">{t('SourceDetail.worldCharacter.dialogueTitle')}</h2> : <span />}
        {samples.length > 1 ? <div role="tablist" aria-label={t('SourceDetail.worldCharacter.dialogueTitle')}
          data-testid="world-character-dialogue-tabs" className="flex max-w-full items-center gap-4 overflow-x-auto"
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (selected + 1) % samples.length
              : event.key === 'ArrowLeft' ? (selected + samples.length - 1) % samples.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? samples.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            setIndex(next);
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}>
          {samples.map((item, ordinal) => <button key={`${item.id}-${ordinal}`} id={`${id}-tab-${ordinal}`} type="button" role="tab"
            aria-selected={ordinal === selected} aria-controls={`${id}-panel`} tabIndex={ordinal === selected ? 0 : -1}
            onClick={() => setIndex(ordinal)}
            className={`-mb-px shrink-0 border-b-2 pb-2.5 text-[0.8125rem] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${ordinal === selected ? 'border-[var(--nimi-text-primary)] font-semibold text-[var(--nimi-text-primary)]' : 'border-transparent font-medium text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]'}`}>
            {item.label}
          </button>)}
        </div> : null}
      </div>
    ) : null}
    <div key={selected} id={`${id}-panel`} role={samples.length > 1 ? 'tabpanel' : undefined}
      aria-labelledby={samples.length > 1 ? `${id}-tab-${selected}` : undefined}
      className={`${showTitle || samples.length > 1 ? 'mt-4' : ''} grid min-w-0 gap-3.5`}>
      <CharacterDialogueExchange source={source} user={sample.user} character={sample.character} />
    </div>
  </section>;
}

export function CharacterDialogueExchange({ source, user, character }: {
  source: SourceDetailData;
  user?: string | null;
  character: string;
}) {
  const { t } = useTranslation();
  return <>
      {user ? <div data-testid="world-character-dialogue-user" className="flex min-w-0 flex-col items-end gap-1">
        <span className="text-[0.6875rem] font-medium text-[var(--nimi-text-muted)]">{t('SourceDetail.worldCharacter.dialogueYou')}</span>
        <div className="char-dialogue-bubble-user max-w-[84%] rounded-[14px] rounded-tr-[4px] px-4 py-2.5">
          <CharacterProfileText text={user} lines={4} textClassName="text-sm leading-[1.72] text-[var(--nimi-text-primary)]" />
        </div>
      </div> : null}
      <div data-testid="world-character-dialogue-character" className="flex min-w-0 items-start gap-2.5">
        <EntityAvatar imageUrl={source.avatarUrl} media={source.avatarMedia} name={source.displayName} kind="human" shape="circle"
          sizeClassName="mt-1 h-8 w-8 shrink-0" radiusClassName="rounded-full"
          fallbackClassName="bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)]" textClassName="text-xs font-semibold" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.6875rem] font-medium text-[var(--nimi-text-muted)]">{source.displayName}</p>
          <div className="char-dialogue-bubble-character mt-1 rounded-[14px] rounded-tl-[4px] px-4 py-3">
            <CharacterProfileText testId="world-character-opening-line" text={character} lines={5} textClassName="text-[0.90625rem] leading-[1.76] text-[var(--nimi-text-primary)]" />
          </div>
        </div>
      </div>
  </>;
}
