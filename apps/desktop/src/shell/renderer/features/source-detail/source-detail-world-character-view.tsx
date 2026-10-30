import { MediaImage } from '@nimiplatform/kit/features/media';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { ChevronRight, Pause, Play, ScrollText } from 'lucide-react';
import { EntityAvatar } from '../../components/entity-avatar.js';
import type { SourceDetailData } from './source-detail-model.js';
import {
  uniqueStrings,
  worldCharacterHeroDescription,
} from './source-detail-world-character-labels.js';
import { buildRelationshipClueItems, WorldCharacterRelationshipCluesSection, WorldCharacterBackgroundSections } from './source-detail-world-character-relationship-clues.js';
import { CharacterActions } from './source-detail-character-actions.js';
import { CharacterFirstMeeting } from './source-detail-character-meeting.js';
import { CharacterAppearanceDisclosure, CharacterProfileSections, characterAboutParagraphs, characterAppearanceDetails } from './source-detail-character-content.js';

type CharacterSourceDetailPageProps = {
  source: SourceDetailData;
  stats?: { friendsCount: number; postsCount: number; likesCount: number } | null;
  onBack?: () => void;
  onOpenWorld: () => void;
  onPrimaryAction: () => void;
  onCreateAnother?: () => void;
  partners?: { localAgentRef: string; displayName: string; capturedAt?: string }[];
  onSelectPartner?: (localAgentRef: string) => void;
  onStartChat?: (initialComposerText?: string) => void;
  primaryActionJoining?: boolean;
};

function WorldCharacterWorksBlock({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const works = source.works.filter((work) => !work.textClue);
  const textClues = source.works.filter((work) => work.textClue === true);
  if (works.length === 0 && textClues.length === 0) return null;
  const countText = works.length > 0
    ? t('SourceDetail.works.count', {
        count: works.length,
        defaultValue: '{{count}} related works collected',
      })
    : textClues.length === 0
      ? t('SourceDetail.works.unavailable', {
          defaultValue: 'Works collection data is not available for this source yet.',
        })
      : null;
  return (
    <section data-testid="world-character-works-section" className="border-t border-[var(--nimi-border-subtle)] py-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
            {t('SourceDetail.works.title', { defaultValue: 'Works collections' })}
          </h2>
          {countText ? (
            <p className="mt-1 text-sm leading-6 text-[var(--nimi-text-muted)]">{countText}</p>
          ) : null}
        </div>
        <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--nimi-action-primary-bg)]">
          {t('SourceDetail.works.badge', { defaultValue: 'Texts' })}
        </span>
      </div>

      {works.length > 0 ? (
        <div data-testid="world-character-works-grid" className="mt-4 grid gap-3 md:grid-cols-2">
          {works.map((work) => (
            <article key={work.id} className="rounded-[14px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-base font-semibold text-[var(--nimi-text-primary)]">{work.title}</h4>
                  {work.romanizedTitle ? (
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{work.romanizedTitle}</p>
                  ) : null}
                  {work.timeLabel ? (
                    <p className="mt-1 text-xs font-semibold text-[var(--nimi-action-primary-bg)]">{work.timeLabel}</p>
                  ) : null}
                </div>
              </div>
              {work.summary ? (
                <p className="mt-3 text-sm leading-6 text-[var(--nimi-text-muted)]">{work.summary}</p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {textClues.length > 0 ? (
        <div
          data-testid="world-character-text-clues"
          className="mt-4 rounded-[14px] border border-dashed border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_55%,transparent)] px-4 py-3"
        >
          <div className="flex items-center gap-1.5 text-[var(--nimi-text-muted)]">
            <ScrollText aria-hidden className="h-3.5 w-3.5" />
            <h4 className="text-xs font-semibold">
              {t('SourceDetail.works.textCluesTitle', { defaultValue: 'Writing clues' })}
            </h4>
          </div>
          <ul className="mt-2 space-y-1.5">
            {textClues.map((clue) => (
              <li
                key={clue.id}
                className="flex items-start gap-2 text-sm leading-6 text-[var(--nimi-text-muted)]"
              >
                <span aria-hidden className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-current" />
                <span className="min-w-0">{clue.summary ?? clue.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// The voice preview renders as a waveform pill next to the hero name: a
// gradient play/pause button on a soft tinted surface, decorative bars that
// pulse while playing, and the sample duration. The backing audio element
// stays hidden and mirrors its playback state into the pill.
const VOICE_WAVE_BAR_HEIGHTS = [5, 8, 12, 7, 10, 14, 9, 13, 6, 10, 12, 8, 11, 6, 9, 12, 7, 10];
const VOICE_WAVE_BAR_MAX_HEIGHT = 14;

function WorldCharacterVoicePill({
  src,
  durationText,
}: {
  src: string;
  durationText: string | null;
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const label = playing
    ? t('SourceDetail.worldCharacter.voicePause', { defaultValue: 'Pause voice' })
    : t('SourceDetail.worldCharacter.voicePlay', { defaultValue: 'Play voice' });

  return (
    <span data-testid="world-character-hero-voice" className="inline-flex min-w-0 items-center">
      <style>{`
        @keyframes nimi-voice-wave-pulse { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
        .nimi-voice-pill {
          background: color-mix(in srgb, var(--nimi-action-primary-bg) 6%, var(--nimi-surface-card));
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent);
          transition: background 200ms ease, box-shadow 200ms ease, transform 120ms ease;
        }
        .nimi-voice-pill:hover {
          background: color-mix(in srgb, var(--nimi-action-primary-bg) 10%, var(--nimi-surface-card));
          box-shadow:
            inset 0 0 0 1px color-mix(in srgb, var(--nimi-action-primary-bg) 26%, transparent),
            0 4px 12px -6px color-mix(in srgb, var(--nimi-action-primary-bg) 35%, transparent);
        }
        .nimi-voice-pill:active { transform: scale(0.96); }
        .nimi-voice-pill[data-playing='true'] {
          background: color-mix(in srgb, var(--nimi-action-primary-bg) 9%, var(--nimi-surface-card));
          box-shadow:
            inset 0 0 0 1px color-mix(in srgb, var(--nimi-action-primary-bg) 30%, transparent),
            0 6px 16px -6px color-mix(in srgb, var(--nimi-action-primary-bg) 42%, transparent);
        }
        @media (prefers-reduced-motion: reduce) {
          .nimi-voice-wave-bar { animation: none !important; }
          .nimi-voice-pill { transition: none; }
        }
      `}</style>
      <button
        type="button"
        data-testid="world-character-voice-play-button"
        data-playing={playing ? 'true' : undefined}
        aria-label={label}
        aria-pressed={playing}
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) {
            return;
          }
          if (playing) {
            audio.pause();
          } else {
            void audio.play();
          }
        }}
        className="nimi-voice-pill group inline-flex h-8 min-w-0 items-center gap-2 rounded-full pl-1 pr-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
      >
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--nimi-action-primary-text)] transition-transform duration-200 ease-out group-hover:scale-[1.06]"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--nimi-action-primary-bg) 80%, white) 0%, var(--nimi-action-primary-bg) 52%, color-mix(in srgb, var(--nimi-action-primary-bg) 86%, black) 100%)',
            boxShadow: '0 2px 6px -1px color-mix(in srgb, var(--nimi-action-primary-bg) 48%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.28)',
          }}
        >
          {playing ? (
            <Pause aria-hidden className="h-2.5 w-2.5" fill="currentColor" strokeWidth={0} />
          ) : (
            <Play aria-hidden className="ml-px h-2.5 w-2.5" fill="currentColor" strokeWidth={0} />
          )}
        </span>
        <span aria-hidden="true" className="flex h-4 shrink-0 items-center gap-[2.5px]">
          {VOICE_WAVE_BAR_HEIGHTS.map((height, index) => {
            const idleAlpha = 26 + Math.round((height / VOICE_WAVE_BAR_MAX_HEIGHT) * 30);
            return (
              <span
                key={index}
                className="nimi-voice-wave-bar w-[2px] rounded-full"
                style={{
                  height: `${height}px`,
                  transformOrigin: 'center',
                  background: playing
                    ? 'linear-gradient(to bottom, color-mix(in srgb, var(--nimi-action-primary-bg) 68%, white) 0%, var(--nimi-action-primary-bg) 100%)'
                    : `color-mix(in srgb, var(--nimi-action-primary-bg) ${idleAlpha}%, transparent)`,
                  animation: playing
                    ? `nimi-voice-wave-pulse 1.1s ease-in-out ${index * -0.08}s infinite`
                    : undefined,
                }}
              />
            );
          })}
        </span>
        {durationText ? (
          <span className="shrink-0 text-[11px] font-medium leading-none tracking-[0.03em] tabular-nums text-[var(--nimi-text-secondary)]">
            {durationText}
          </span>
        ) : null}
        <span className="sr-only">
          {t('SourceDetail.worldCharacter.voicePreview', { defaultValue: 'Voice preview' })}
        </span>
      </button>
      <audio
        ref={audioRef}
        data-testid="world-character-voice-sample-audio"
        className="hidden"
        preload="metadata"
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </span>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r033
// One layout serves both source kinds. Optional sections use authored data;
// names, species and narrative prose never choose a character-specific template.
export function CharacterSourceDetailPage(props: CharacterSourceDetailPageProps) {
  const { t } = useTranslation();
  const { source } = props;
  const profile = source.characterProfile;
  const bannerMedia = source.profileCoverMedia ?? source.worldBannerMedia ?? source.referenceImageMedia;
  const bannerUrl = source.profileCoverUrl ?? source.worldBannerUrl ?? source.referenceImageUrl;
  const heroIdentity = uniqueStrings([profile.ageDescription, profile.speciesDescription]).join(' · ');
  const heroRole = worldCharacterHeroDescription(source, t);
  const voiceSample = source.voiceSample;
  const voiceDurationSec = voiceSample?.durationSec != null && Number.isFinite(voiceSample.durationSec)
    ? Math.max(0, Math.round(voiceSample.durationSec)) : null;
  const voiceDurationText = voiceDurationSec != null
    ? `· ${t('SourceDetail.worldCharacter.voicePreviewDuration', { seconds: voiceDurationSec })}` : null;
  const meetingScene = profile.interaction?.scenario?.trim();
  const hasDialogue = Boolean(profile.dialogueExemplars?.length || profile.interaction?.greeting?.trim());
  const relationships = buildRelationshipClueItems(source, t);
  const hasPeople = relationships.some(item => item.group === 'people');
  const hasLeftColumn = Boolean(characterAboutParagraphs(source).length || profile.drives?.length
    || profile.knowledgeTopics.length || profile.knowledgeConstraints.length || profile.boundaries?.length
    || characterAppearanceDetails(source).length
    || relationships.some(item => item.group === 'life' || item.group === 'objects'));
  const hasRightColumn = Boolean(profile.interaction?.meetingScenes?.length || meetingScene || hasDialogue || hasPeople);

  return (
    <div data-testid="character-source-detail-page" data-source-kind={source.sourceKind} className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" contentClassName="w-full">
        <section data-testid="world-character-overview-section" data-nimi-density="expressive" className="min-w-0">
          <div data-testid="world-character-hero-banner" className="relative mx-auto h-[260px] w-full max-w-[1360px] overflow-hidden rounded-[24px] max-[720px]:h-[178px]"
            style={{ backgroundImage: 'var(--nimi-surface-hero)' }}>
            {bannerMedia || bannerUrl ? <MediaImage delivery={bannerMedia} externalUrl={bannerUrl} purpose="hero"
              sizes="auto, 1360px" loading="eager" fetchPriority="high" alt="" className="absolute inset-0 h-full w-full object-cover object-[center_20%]" /> : null}
            {source.worldId && source.worldName ? <button type="button" data-testid="world-character-world-pill" onClick={props.onOpenWorld}
              className="absolute right-6 top-6 z-10 inline-flex max-w-[min(360px,60%)] items-center gap-1.5 rounded-full border border-[var(--nimi-material-glass-thin-border)] bg-[var(--nimi-material-glass-thin-bg)] px-3.5 py-2 shadow-[var(--nimi-elevation-raised)] nimi-material-glass-thin focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
              <span className="shrink-0 text-xs text-[var(--nimi-text-secondary)]">{t('SourceDetail.worldCharacter.worldPill')}</span>
              <span className="min-w-0 truncate text-xs font-semibold text-[var(--nimi-text-primary)]">{source.worldName}</span>
              <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--nimi-text-muted)]" />
            </button> : null}
          </div>

          <div className="mx-auto max-w-[1400px] px-8 pb-8 max-[720px]:px-5">
            <div className="flex items-start gap-7 max-[720px]:flex-wrap max-[720px]:gap-4">
              <div data-testid="world-character-hero-avatar"
                className="relative -mt-16 h-36 w-36 shrink-0 overflow-hidden rounded-[24px] bg-[var(--nimi-surface-card)] max-[720px]:-mt-12 max-[720px]:h-24 max-[720px]:w-24"
                style={{ boxShadow: '0 0 0 4px var(--nimi-surface-card), var(--nimi-elevation-raised)' }}>
                <EntityAvatar imageUrl={source.avatarUrl} media={source.avatarMedia} name={source.displayName} kind="human" shape="rounded"
                  sizeClassName="h-full w-full" radiusClassName="rounded-[24px]"
                  fallbackClassName="bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-panel))] text-[var(--nimi-text-primary)]" textClassName="text-4xl font-semibold" />
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-6 gap-y-4 pt-5 max-[720px]:basis-full max-[720px]:pt-0">
                <div className="min-w-0 max-w-full">
                  <div data-testid="world-character-hero-title-row" className="flex flex-wrap items-center gap-4">
                    <h1 className="break-words text-[40px] font-bold leading-tight tracking-normal text-[var(--nimi-text-primary)] max-[720px]:text-[32px]">{source.displayName}</h1>
                    {voiceSample ? <WorldCharacterVoicePill key={voiceSample.previewUrl} src={voiceSample.previewUrl} durationText={voiceDurationText} /> : null}
                  </div>
                  {heroIdentity ? <p data-testid="world-character-hero-description" className="mt-2 text-[15px] font-medium leading-6 text-[var(--nimi-text-secondary)]">{heroIdentity}</p> : null}
                  {heroRole ? <p data-testid="world-character-hero-role" className="mt-0.5 text-[15px] leading-6 text-[var(--nimi-text-secondary)]">{heroRole}</p> : null}
                </div>
                <CharacterActions {...props} />
              </div>
            </div>

            {hasLeftColumn || hasRightColumn ? <div data-testid="world-character-overview-columns" className="mt-6 border-t border-[var(--nimi-border-subtle)] pt-6">
              <div data-testid="world-character-reading-columns"
                className={`grid items-start gap-6 ${hasLeftColumn && hasRightColumn ? 'min-[1000px]:grid-cols-[minmax(0,0.92fr)_1px_minmax(0,1.08fr)] min-[1000px]:gap-x-6' : 'max-w-3xl'}`}>
                {hasLeftColumn ? <div data-testid="world-character-profile-column" className="grid min-w-0 content-start gap-5">
                  <CharacterProfileSections source={source} />
                  <WorldCharacterBackgroundSections source={source} />
                  <CharacterAppearanceDisclosure source={source} />
                </div> : null}
                {hasLeftColumn && hasRightColumn ? <div aria-hidden="true" data-testid="world-character-reading-columns-divider"
                  className="hidden w-px self-stretch bg-[var(--nimi-border-subtle)] min-[1000px]:block" /> : null}
                {hasRightColumn ? <div data-testid="world-character-conversation-column" className="grid min-w-0 content-start gap-5">
                  <CharacterFirstMeeting source={source} />
                  <WorldCharacterRelationshipCluesSection source={source} />
                </div> : null}
              </div>
            </div> : null}
          </div>
        </section>
        <div className="mx-auto max-w-[1400px] px-8 max-[720px]:px-5"><WorldCharacterWorksBlock source={source} /></div>
      </ScrollArea>
    </div>
  );
}
