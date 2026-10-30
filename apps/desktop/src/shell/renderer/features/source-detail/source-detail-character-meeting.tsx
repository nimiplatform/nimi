import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceDetailData } from './source-detail-model.js';
import { CharacterProfileText } from './source-detail-character-content.js';
import { CharacterDialogue, CharacterDialogueExchange } from './source-detail-character-dialogue.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r033
export function CharacterFirstMeeting({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const id = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const interaction = source.characterProfile.interaction;
  const scenes = interaction?.meetingScenes ?? [];
  const selected = Math.max(0, scenes.findIndex(scene => scene.sceneId === selectedId));
  const scene = scenes[selected];
  const scenario = scene?.scenario ?? interaction?.scenario?.trim();
  const multiple = scenes.length > 1;

  return <>
    {scenario ? <section data-testid="world-character-first-meeting-section">
      <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">{t('SourceDetail.worldCharacter.firstMeetingTitle')}</h2>
      {multiple ? <div role="tablist" aria-label={t('SourceDetail.worldCharacter.firstMeetingTitle')}
        data-testid="world-character-meeting-tabs" className="mt-4 flex gap-2 overflow-x-auto pb-2"
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (selected + 1) % scenes.length
            : event.key === 'ArrowLeft' ? (selected + scenes.length - 1) % scenes.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? scenes.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          setSelectedId(scenes[next]!.sceneId);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>
        {scenes.map((item, index) => <button key={item.sceneId} type="button" role="tab"
          id={`${id}-tab-${index}`} aria-selected={index === selected} aria-controls={`${id}-panel`}
          tabIndex={index === selected ? 0 : -1} onClick={() => setSelectedId(item.sceneId)}
          className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${index === selected ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'}`}>
          {item.title}
        </button>)}
      </div> : scene ? <h3 className="mt-4 text-sm font-medium text-[var(--nimi-text-secondary)]">{scene.title}</h3> : null}
      <div key={scene?.sceneId ?? 'scenario'} id={`${id}-panel`} role={multiple ? 'tabpanel' : undefined}
        aria-labelledby={multiple ? `${id}-tab-${selected}` : undefined} tabIndex={multiple ? 0 : undefined}
        className="mt-4 grid min-w-0 gap-5 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
        <CharacterProfileText testId="world-character-meeting-scene" text={scenario} lines={4} />
        {scene ? <CharacterDialogueExchange source={source} character={scene.greeting} /> : null}
      </div>
    </section> : null}
    <CharacterDialogue source={source} includeGreeting={!scene} showTitle={Boolean(scene)} />
  </>;
}
