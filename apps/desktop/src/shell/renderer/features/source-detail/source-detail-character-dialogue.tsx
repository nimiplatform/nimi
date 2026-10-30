import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import type { SourceDetailData } from './source-detail-model.js';
import { CharacterProfileText } from './source-detail-character-content.js';

export function CharacterDialogue({ source, includeGreeting = true, showTitle = false }: {
  source: SourceDetailData;
  includeGreeting?: boolean;
  showTitle?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [index, setIndex] = useState(0);
  const exemplars = source.characterProfile.dialogueExemplars ?? [];
  const greeting = includeGreeting ? source.characterProfile.interaction?.greeting?.trim() : null;
  const samples = [
    ...exemplars.map((sample, ordinal) => ({ ...sample,
      // Dialogue exemplars have no scene title. Do not infer one from ids or prose.
      label: t('SourceDetail.worldCharacter.dialogueNumber', { number: ordinal + 1 }),
    })),
    ...(greeting && !exemplars.some(sample => !sample.user && sample.character === greeting)
      ? [{ id: 'greeting', user: null, character: greeting, label: t('SourceDetail.worldCharacter.greetingTab') }] : []),
  ];
  const selected = index < samples.length ? index : 0;
  const sample = samples[selected];
  if (!sample) return null;
  return <section data-testid="world-character-dialogue-section">
    {showTitle ? <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">{t('SourceDetail.worldCharacter.dialogueTitle')}</h2> : null}
    {samples.length > 1 ? <div role="tablist" aria-label={t('SourceDetail.worldCharacter.dialogueTitle')}
      data-testid="world-character-dialogue-tabs" className="mt-3 flex gap-5 overflow-x-auto border-b border-[var(--nimi-border-subtle)]"
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
        className={`shrink-0 border-b-2 px-1 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${ordinal === selected ? 'border-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-bg)]' : 'border-transparent text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'}`}>
        {item.label}
      </button>)}
    </div> : null}
    <div key={selected} id={`${id}-panel`} role={samples.length > 1 ? 'tabpanel' : undefined}
      aria-labelledby={samples.length > 1 ? `${id}-tab-${selected}` : undefined}
      className="mt-4 grid min-w-0 gap-3">
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
      {user ? <div data-testid="world-character-dialogue-user" className="flex min-w-0 flex-col items-end gap-1.5">
        <span className="text-xs text-[var(--nimi-text-muted)]">{t('SourceDetail.worldCharacter.dialogueYou')}</span>
        <div className="max-w-[90%] rounded-2xl rounded-tr-md bg-[var(--nimi-surface-panel)] px-4 py-3">
          <CharacterProfileText text={user} lines={3} className="text-[var(--nimi-text-primary)]" />
        </div>
      </div> : null}
      <div data-testid="world-character-dialogue-character" className="flex min-w-0 items-start gap-3">
        <EntityAvatar imageUrl={source.avatarUrl} media={source.avatarMedia} name={source.displayName} kind="human" shape="circle"
          sizeClassName="h-9 w-9 shrink-0" radiusClassName="rounded-full"
          fallbackClassName="bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-panel))] text-[var(--nimi-text-primary)]" textClassName="text-sm font-semibold" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--nimi-text-secondary)]">{source.displayName}</p>
          <div className="mt-1.5 rounded-2xl rounded-tl-md bg-[var(--nimi-surface-panel)] px-4 py-3">
            <CharacterProfileText testId="world-character-opening-line" text={character} lines={4} className="text-[var(--nimi-text-primary)]" />
          </div>
        </div>
      </div>
  </>;
}
