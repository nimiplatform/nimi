import { MediaImage } from '@nimiplatform/kit/features/media';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ScrollArea } from '@nimiplatform/kit/ui';
import { ArrowLeft, ChevronRight, CirclePlus, MessageCircle, Pause, Play, RefreshCw, ScrollText } from 'lucide-react';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { describeCharacterPrimaryAction } from '../explore/character-source-materialization';
import type { SourceDetailData } from './source-detail-model.js';
import {
  uniqueStrings,
  worldCharacterHeroDescription,
  worldCharacterPrimaryActionLabel,
} from './source-detail-world-character-labels.js';
import { buildRelationshipClueItems, WorldCharacterRelationshipCluesSection, WorldCharacterBackgroundSections } from './source-detail-world-character-relationship-clues.js';

type CharacterSourceDetailPageProps = {
  source: SourceDetailData;
  stats?: { friendsCount: number; postsCount: number; likesCount: number } | null;
  // Embedded hosts (e.g. the Explore persona rail+detail layout) omit onBack;
  // the hero back control is hidden when it is absent.
  onBack?: () => void;
  onOpenWorld: () => void;
  onPrimaryAction: () => void;
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
    <section data-testid="world-character-works-section" className="rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-elevation-base)]">
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

type WorldCharacterDialogueSample = {
  id: string;
  user: string | null;
  character: string;
};

// The hero banner anchors the card: the back control sits on its top-left and
// the host world pill on its top-right. Below the banner an enlarged avatar
// overlaps the banner edge, followed by name, an explicit subtitle line
// (role, optionally age), and the voice preview. The body splits into two
// columns: authored prose and relationships on the left, a sample exchange
// on the right.
export function CharacterSourceDetailPage(props: CharacterSourceDetailPageProps) {
  const { t } = useTranslation();
  const { source } = props;
  const bannerMedia = source.profileCoverMedia ?? source.worldBannerMedia ?? source.referenceImageMedia;
  const bannerUrl = source.profileCoverUrl ?? source.worldBannerUrl ?? source.referenceImageUrl;
  const primaryAction = describeCharacterPrimaryAction(source.sourceState, t);
  const canStartChat = primaryAction.action === 'open_partner';
  const primaryActionJoining = props.primaryActionJoining === true && !canStartChat;
  const heroRole = worldCharacterHeroDescription(source, t);
  const heroSubtitle = uniqueStrings([heroRole, source.characterProfile.ageDescription]).join(' · ');
  const interaction = source.characterProfile.interaction;
  const voiceSample = source.voiceSample;
  const voiceDurationSec = voiceSample?.durationSec != null && Number.isFinite(voiceSample.durationSec)
    ? Math.max(0, Math.round(voiceSample.durationSec))
    : null;
  const voiceDurationText = voiceDurationSec != null
    ? `· ${t('SourceDetail.worldCharacter.voicePreviewDuration', {
        seconds: voiceDurationSec,
        defaultValue: '{{seconds}}s',
      })}`
    : null;
  const dialogueSamples: WorldCharacterDialogueSample[] = [
    ...(source.characterProfile.dialogueExemplars ?? []),
    ...(interaction?.greeting
      ? [{ id: 'greeting', user: null, character: interaction.greeting }]
      : []),
  ];
  const [dialogueIndex, setDialogueIndex] = useState(0);
  const dialogueSample = dialogueSamples.length > 0
    ? dialogueSamples[dialogueIndex % dialogueSamples.length]
    : undefined;
  // The authored interaction scene is shared by its exemplars and greeting.
  // Rotating the exchange keeps that same scene; changing source replaces both.
  const meetingScene = interaction?.scenario?.trim() || null;
  // Keep authored prose as two reading paragraphs. Voice directions belong to
  // the sample exchange and audio, not synthesized biography in the renderer.
  const aboutParagraphs = [
    {
      key: 'intro',
      value: source.entity?.summary?.trim() || source.bio?.trim(),
      testId: 'character-introduction',
    },
    {
      key: 'disposition',
      value: source.characterProfile.disposition?.trim(),
      testId: 'character-disposition',
    },
  ].filter((item): item is typeof item & { value: string } => Boolean(item.value && item.value.trim()));
  const hasDialogue = Boolean(dialogueSample);
  const hasAbout = aboutParagraphs.length > 0;
  const hasLeftColumn = hasAbout || buildRelationshipClueItems(source, t)
    .some(item => item.group === 'people' || item.group === 'life' || item.group === 'objects');
  const hasRightColumn = Boolean(meetingScene) || hasDialogue;
  const showOverviewColumns = hasLeftColumn || hasRightColumn;

  return (
    <div
      data-testid="character-source-detail-page"
      data-source-kind={source.sourceKind ?? undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ScrollArea
        className="flex-1"
        contentClassName="mx-auto max-w-[1180px] px-5 py-6"
      >
        <div className="grid gap-5">
          <section
            data-testid="world-character-overview-section"
            data-nimi-density="expressive"
            className="overflow-hidden rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)]"
          >
            <div
              data-testid="world-character-hero-banner"
              className="relative h-[280px] max-[720px]:h-[190px]"
              style={{
                backgroundImage: 'var(--nimi-surface-hero)',
                backgroundSize: 'cover',
                backgroundPosition: 'center 20%',
              }}
            >
              {bannerMedia || bannerUrl ? <MediaImage delivery={bannerMedia} externalUrl={bannerUrl} purpose="hero" sizes="auto, 1100px" loading="eager" fetchPriority="high" alt="" className="absolute inset-0 h-full w-full object-cover object-[center_20%]" /> : null}
              {props.onBack ? (
                <button
                  type="button"
                  data-testid="world-character-back-button"
                  onClick={props.onBack}
                  aria-label={t('Common.back', { defaultValue: 'Back' })}
                  className="absolute left-6 top-6 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--nimi-material-glass-thin-border)] bg-[var(--nimi-material-glass-thin-bg)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-raised)] nimi-material-glass-thin backdrop-blur-[var(--nimi-backdrop-blur-thin)] transition hover:bg-white/86 hover:text-[var(--nimi-action-primary-bg)]"
                >
                  <ArrowLeft aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.2} />
                </button>
              ) : null}
              {source.worldId && source.worldName ? (
                <button
                  type="button"
                  data-testid="world-character-world-pill"
                  onClick={props.onOpenWorld}
                  className="absolute right-6 top-6 z-10 inline-flex max-w-[min(360px,60%)] items-center gap-1.5 rounded-full border border-[var(--nimi-material-glass-thin-border)] bg-[var(--nimi-material-glass-thin-bg)] px-3.5 py-2 shadow-[var(--nimi-elevation-raised)] nimi-material-glass-thin backdrop-blur-[var(--nimi-backdrop-blur-thin)] transition hover:bg-white/86"
                >
                  <span className="shrink-0 text-xs text-[var(--nimi-text-secondary)]">
                    {t('SourceDetail.worldCharacter.worldPill', { defaultValue: 'World' })}
                  </span>
                  <span className="min-w-0 truncate text-xs font-semibold text-[var(--nimi-text-primary)]">{source.worldName}</span>
                  <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--nimi-text-muted)]" />
                </button>
              ) : null}
            </div>

            <div className="px-9 pb-7 max-[720px]:px-5">
              <div className="flex items-start gap-8 max-[720px]:flex-col max-[720px]:gap-6">
                <div
                  data-testid="world-character-hero-avatar"
                  className="relative -mt-[80px] h-[160px] w-[160px] shrink-0 overflow-hidden rounded-[24px] bg-[var(--nimi-surface-card)] max-[720px]:-mt-[60px] max-[720px]:h-[120px] max-[720px]:w-[120px]"
                  style={{ boxShadow: '0 0 0 4px var(--nimi-surface-card), var(--nimi-elevation-raised)' }}
                >
                  <EntityAvatar
                    imageUrl={source.avatarUrl} media={source.avatarMedia}
                    name={source.displayName}
                    kind="human"
                    shape="rounded"
                    sizeClassName="h-full w-full"
                    radiusClassName="rounded-[24px]"
                    fallbackClassName="bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-panel))] text-[var(--nimi-text-primary)]"
                    textClassName="text-4xl font-semibold"
                  />
                </div>

                <div className="min-w-0 flex-1 max-[720px]:w-full">
                  <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-6 pt-6 max-[720px]:pt-0">
                    <div className="min-w-0">
                      <div data-testid="world-character-hero-title-row" className="flex flex-wrap items-center gap-4">
                        <h1 className="text-[44px] font-bold leading-[1.04] tracking-normal text-[var(--nimi-text-primary)] max-[900px]:text-[38px] max-[620px]:text-[34px]">
                          {source.displayName}
                        </h1>
                        {voiceSample ? (
                          <WorldCharacterVoicePill src={voiceSample.previewUrl} durationText={voiceDurationText} />
                        ) : null}
                      </div>
                      {heroSubtitle ? (
                        <p data-testid="world-character-hero-description" className="mt-3 text-[16px] font-medium leading-6 text-[var(--nimi-text-secondary)]">
                          {heroSubtitle}
                        </p>
                      ) : null}
                    </div>

                    <div className="ml-auto flex min-w-0 flex-col items-end gap-3 max-[720px]:ml-0 max-[720px]:w-full max-[720px]:items-start">
                      <div data-testid="world-character-hero-actions" className="flex flex-wrap items-center justify-end gap-3 max-[720px]:justify-start">
                        {source.worldId && !source.worldName ? (
                          <button
                            type="button"
                            onClick={props.onOpenWorld}
                            className="rounded-[10px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-xs font-semibold text-[var(--nimi-action-primary-bg)]"
                          >
                            {t('SourceDetail.openWorld', { defaultValue: 'Open World' })}
                          </button>
                        ) : null}
                        {canStartChat ? (
                          <Button
                            type="button"
                            tone="primary"
                            size="lg"
                            onClick={() => props.onStartChat?.()}
                            disabled={!props.onStartChat || props.primaryActionJoining}
                          >
                            <MessageCircle aria-hidden className="h-[16px] w-[16px]" strokeWidth={2.2} />
                            {t('SourceDetail.worldCharacter.chatNow', { defaultValue: 'Chat now' })}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            tone="primary"
                            size="lg"
                            onClick={props.onPrimaryAction}
                            disabled={primaryAction.disabled || primaryActionJoining}
                            data-source-state={source.sourceState}
                            data-primary-action={primaryAction.action}
                          >
                            <CirclePlus aria-hidden className="h-[16px] w-[16px]" strokeWidth={2.2} />
                            {primaryActionJoining
                              ? t('SourceDetail.worldCharacter.primaryActionJoining', { defaultValue: 'Adding…' })
                              : worldCharacterPrimaryActionLabel(primaryAction, t)}
                          </Button>
                        )}
                      </div>
                      {(props.partners?.length ?? 0) > 1 && props.onSelectPartner ? (
                        <div className="grid w-full gap-2">
                          <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                            {t('SourceDetail.choosePartner', { defaultValue: 'Choose a partner' })}
                          </p>
                          {props.partners!.map(partner => (
                            <Button key={partner.localAgentRef} type="button" tone="secondary"
                              onClick={() => props.onSelectPartner?.(partner.localAgentRef)}
                              disabled={props.primaryActionJoining} className="h-auto justify-start whitespace-normal py-2 text-left">
                              {partner.displayName} · {partner.capturedAt
                                ? t('SourceDetail.partnerCreatedAt', { defaultValue: 'Created {{date}}', date: new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(partner.capturedAt)) })
                                : t('SourceDetail.partnerCreationUnknown', { defaultValue: 'Creation time unavailable' })}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {showOverviewColumns ? (
                <div data-testid="world-character-overview-columns" className="mt-7 grid gap-8 border-t border-[var(--nimi-border-subtle)] pt-7">
                  {hasLeftColumn || hasRightColumn ? (
                    <div data-testid="world-character-reading-columns" className={`grid items-start gap-10 ${hasLeftColumn && hasRightColumn ? 'min-[900px]:grid-cols-[minmax(0,2fr)_1px_minmax(0,3fr)] min-[900px]:gap-x-5' : ''}`}>
                      {hasLeftColumn ? (
                        <div data-testid="world-character-profile-column" className="grid min-w-0 content-start gap-5">
                          {hasAbout ? (
                            <section data-testid="world-character-about-section" className="min-w-0">
                              <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
                                {t('SourceDetail.worldCharacter.aboutTitle', {
                                  name: source.displayName,
                                  defaultValue: 'About {{name}}',
                                })}
                              </h2>
                              <div className="mt-5 grid gap-5">
                                {aboutParagraphs.map((paragraph) => (
                                  <p key={paragraph.key} data-testid={paragraph.testId} className="whitespace-pre-wrap text-sm leading-7 text-[var(--nimi-text-secondary)]">
                                    {paragraph.value}
                                  </p>
                                ))}
                              </div>
                            </section>
                          ) : null}
                          <WorldCharacterRelationshipCluesSection source={source} />
                          <WorldCharacterBackgroundSections source={source} />
                        </div>
                      ) : null}

                      {hasLeftColumn && hasRightColumn ? (
                        <div
                          aria-hidden="true"
                          data-testid="world-character-reading-columns-divider"
                          className="hidden w-px self-stretch bg-[var(--nimi-border-subtle)] min-[900px]:block"
                        />
                      ) : null}

                      {hasRightColumn ? (
                        <div data-testid="world-character-conversation-column" className="grid min-w-0 content-start gap-8">
                          {meetingScene || hasDialogue ? (
                            <section data-testid="world-character-first-meeting-section" className="min-w-0">
                              <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
                                {t('SourceDetail.worldCharacter.firstMeetingTitle', { defaultValue: 'First meeting' })}
                              </h2>
                              <div className="mt-5 grid min-w-0 gap-5">
                              {meetingScene ? (
                                <p data-testid="world-character-meeting-scene" className="whitespace-pre-wrap text-sm leading-7 text-[var(--nimi-text-secondary)]">{meetingScene}</p>
                              ) : null}
                              {hasDialogue && dialogueSample ? (
                                <div data-testid="world-character-dialogue-section" className="min-w-0">
                                  <div className="grid gap-4">
                                    {dialogueSample.user ? (
                                      <div data-testid="world-character-dialogue-user" className="flex min-w-0 flex-col items-end gap-1.5">
                                        <span className="text-xs text-[var(--nimi-text-muted)]">
                                          {t('SourceDetail.worldCharacter.dialogueYou', { defaultValue: 'You' })}
                                        </span>
                                        <p className="max-w-[85%] whitespace-pre-wrap rounded-[16px] rounded-tr-[6px] bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm leading-6 text-[var(--nimi-text-primary)]">
                                          {dialogueSample.user}
                                        </p>
                                      </div>
                                    ) : null}
                                    <div data-testid="world-character-dialogue-character" className="flex min-w-0 items-start gap-3">
                                      <EntityAvatar
                                        imageUrl={source.avatarUrl} media={source.avatarMedia}
                                        name={source.displayName}
                                        kind="human"
                                        shape="circle"
                                        sizeClassName="h-9 w-9 shrink-0"
                                        radiusClassName="rounded-full"
                                        fallbackClassName="bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-panel))] text-[var(--nimi-text-primary)]"
                                        textClassName="text-sm font-semibold"
                                      />
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium text-[var(--nimi-text-secondary)]">{source.displayName}</p>
                                        <p data-testid="world-character-opening-line" className="mt-1.5 whitespace-pre-wrap rounded-[16px] rounded-tl-[6px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 text-sm leading-6 text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]">
                                          {dialogueSample.character}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                  {dialogueSamples.length > 1 ? (
                                    <div className="mt-3 flex justify-end">
                                      <button
                                        type="button"
                                        data-testid="world-character-dialogue-refresh"
                                        onClick={() => setDialogueIndex((index) => index + 1)}
                                        className="inline-flex min-h-8 items-center gap-1.5 rounded px-1 text-xs font-medium text-[var(--nimi-text-muted)] transition hover:text-[var(--nimi-action-primary-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                                      >
                                        {t('SourceDetail.worldCharacter.dialogueRefresh', { defaultValue: 'Read another' })}
                                        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              </div>
                            </section>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                </div>
              ) : null}
            </div>
          </section>

          <main className="grid min-w-0 gap-5">
            <WorldCharacterWorksBlock source={source} />
          </main>
        </div>
      </ScrollArea>
    </div>
  );
}
