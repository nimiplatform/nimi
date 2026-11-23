import { MediaImage } from '@nimiplatform/kit/features/media';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { ChevronDown, ChevronRight, Globe, Pause, Play, ScrollText } from 'lucide-react';
import { EntityAvatar } from '../../components/entity-avatar.js';
import type { SourceDetailData } from './source-detail-model.js';
import { abbreviatedWorkReference, relationshipDetailCopy, sourceDetailDisplayText } from './source-detail-world-character-copy.js';
import {
  worldCharacterHeroDescription,
  worldCharacterHeroTraits,
} from './source-detail-world-character-labels.js';
import {
  buildRelationshipClueItems,
  WorldCharacterRelationshipCluesSection,
  WorldCharacterBackgroundSections,
} from './source-detail-world-character-relationship-clues.js';
import { CharacterActions } from './source-detail-character-actions.js';
import { CharacterVisualGallery } from './source-detail-character-gallery.js';
import { CharacterFirstMeeting } from './source-detail-character-meeting.js';
import {
  CharacterAboutSection,
  CharacterGuidanceCard,
  CharacterLifeEventsSection,
  CharacterProfileSpecsCard,
  characterAboutParagraphs,
  hasCharacterGuidanceContent,
  hasCharacterProfileSpecs,
} from './source-detail-character-content.js';

type CharacterSourceDetailPageProps = {
  source: SourceDetailData;
  partner?: {
    displayName: string;
    avatarUrl?: string | null;
    actions: ReactNode;
    stickyActions?: ReactNode;
    status: ReactNode;
    sourceNotice: ReactNode;
  };
  stats?: { friendsCount: number; postsCount: number; likesCount: number } | null;
  onBack?: () => void;
  onOpenWorld: () => void;
  onPrimaryAction: () => void;
  onStartChat?: (initialComposerText?: string) => void;
  primaryActionJoining?: boolean;
};

function WorldCharacterWorksBlock({ source }: { source: SourceDetailData }) {
  const { t, i18n } = useTranslation();
  const display = (text: string) => sourceDetailDisplayText(text, i18n.resolvedLanguage ?? i18n.language);
  const works = source.works.filter((work) => !work.textClue).map(work => ({
    ...work,
    summary: relationshipDetailCopy(work.summary, source.displayName, work.title, 'text'),
  }));
  const introducedWorks = works.filter(work => work.summary || work.timeLabel);
  const bibliography = works.filter(work => !work.summary && !work.timeLabel);
  const referenceClues = source.works.filter(work => work.textClue).map(work => ({
    work, reference: abbreviatedWorkReference(work.summary, source.displayName),
  }));
  const compactReferences = referenceClues.flatMap(({ work, reference }) => reference ? [{ work, reference }] : []);
  const textClues = referenceClues.filter(clue => !clue.reference).map(clue => clue.work);
  if (source.works.length === 0) return null;
  const countText = compactReferences.length === 0 && works.length > 0
    ? t('SourceDetail.works.count', {
        count: works.length,
        defaultValue: '{{count}} related works collected',
      })
    : null;
  return (
    <section data-testid="world-character-works-section" className="border-t border-[var(--nimi-border-subtle)] pt-10 pb-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[var(--nimi-text-primary)]">
            {t('SourceDetail.works.title', { defaultValue: 'Works collections' })}
          </h2>
          {countText ? (
            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{countText}</p>
          ) : null}
        </div>
      </div>

      {introducedWorks.length > 0 ? (
        <div data-testid="world-character-works-grid" className="mt-5 grid gap-4 md:grid-cols-2">
          {introducedWorks.map((work) => (
            <article key={work.id} className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] p-5 transition-colors hover:bg-[var(--nimi-surface-active)]">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-[var(--nimi-text-primary)] [overflow-wrap:anywhere]">{display(work.title)}</h3>
                {work.romanizedTitle ? (
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{display(work.romanizedTitle)}</p>
                ) : null}
                {work.timeLabel ? (
                  <p className="mt-1 text-xs font-medium tabular-nums text-[var(--nimi-text-muted)]">{display(work.timeLabel)}</p>
                ) : null}
              </div>
              {work.summary ? (
                <p className="mt-2.5 text-sm leading-[1.75] text-[var(--nimi-text-secondary)]">{display(work.summary)}</p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {bibliography.length > 0 || compactReferences.length > 0 ? <div className="mt-6">
        <h3 className="text-xs font-semibold tracking-[0.02em] text-[var(--nimi-text-muted)]">{t('SourceDetail.works.bibliographyTitle')}</h3>
        <ul data-testid="world-character-bibliography" className="mt-3 grid gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {bibliography.map(work => <li key={work.id} className="min-w-0 text-sm leading-6 text-[var(--nimi-text-primary)] [overflow-wrap:anywhere]">
            {display(work.title)}
            {work.romanizedTitle ? <p className="text-xs text-[var(--nimi-text-muted)]">{display(work.romanizedTitle)}</p> : null}
          </li>)}
          {compactReferences.map(({ work, reference }) => <li key={work.id} className="min-w-0 text-sm leading-6 text-[var(--nimi-text-primary)] [overflow-wrap:anywhere]">
            {display(reference)}
            {work.timeLabel ? <p className="text-xs tabular-nums text-[var(--nimi-text-muted)]">{display(work.timeLabel)}</p> : null}
          </li>)}
        </ul>
      </div> : null}

      {textClues.length > 0 ? (
        <div
          data-testid="world-character-text-clues"
          className="mt-6 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] px-5 py-4"
        >
          <div className="flex items-center gap-1.5 text-[var(--nimi-text-muted)]">
            <ScrollText aria-hidden className="h-3.5 w-3.5" />
            <h4 className="text-xs font-semibold">
              {t('SourceDetail.works.textCluesTitle', { defaultValue: 'Writing clues' })}
            </h4>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {textClues.map((clue) => (
              <li
                key={clue.id}
                className="text-sm leading-6 text-[var(--nimi-text-secondary)]"
              >
                {display(clue.summary ?? clue.title)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const VOICE_WAVE_BAR_HEIGHTS = [4, 7, 11, 6, 9, 13, 8, 12, 5, 9, 11, 7, 10, 6];
const VOICE_WAVE_BAR_MAX_HEIGHT = 13;

function WorldCharacterVoicePill({
  playing,
  progress,
  durationText,
  onToggle,
  compact = false,
}: {
  playing: boolean;
  progress: number;
  durationText: string | null;
  onToggle: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const label = playing
    ? t('SourceDetail.worldCharacter.voicePause', { defaultValue: 'Pause voice' })
    : t('SourceDetail.worldCharacter.voicePlay', { defaultValue: 'Play voice' });

  return (
    <span data-testid={compact ? 'world-character-sticky-voice' : 'world-character-hero-voice'} className="inline-flex min-w-0 items-center">
      <button
        type="button"
        data-testid={compact ? 'world-character-sticky-voice-play-button' : 'world-character-voice-play-button'}
        data-playing={playing ? 'true' : undefined}
        aria-label={label}
        aria-pressed={playing}
        onClick={onToggle}
        className={`group inline-flex min-w-0 items-center gap-2 rounded-[10px] bg-[var(--nimi-surface-panel)] pl-1.5 pr-2.5 ring-1 ring-[var(--nimi-border-subtle)] transition-colors hover:bg-[var(--nimi-surface-active)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${compact ? 'h-7' : 'h-8'}`}
      >
        <span
          className={`grid shrink-0 place-items-center rounded-[7px] bg-[var(--nimi-text-primary)] text-[var(--nimi-surface-card)] transition-opacity group-hover:opacity-90 ${compact ? 'h-5 w-5' : 'h-[22px] w-[22px]'}`}
        >
          {playing ? (
            <Pause aria-hidden className="h-2.5 w-2.5" fill="currentColor" strokeWidth={0} />
          ) : (
            <Play aria-hidden className="ml-px h-2.5 w-2.5" fill="currentColor" strokeWidth={0} />
          )}
        </span>
        {!compact ? (
          <span aria-hidden="true" className="flex h-3.5 shrink-0 items-center gap-[2px]">
            {VOICE_WAVE_BAR_HEIGHTS.map((height, index) => {
              const threshold = (index + 1) / VOICE_WAVE_BAR_HEIGHTS.length;
              const elapsed = progress > 0 && threshold <= progress;
              const idleAlpha = 22 + Math.round((height / VOICE_WAVE_BAR_MAX_HEIGHT) * 26);
              return (
                <span
                  key={index}
                  className="char-voice-wave-bar w-[1.5px] rounded-full transition-colors duration-150"
                  style={{
                    height: `${height}px`,
                    transformOrigin: 'center',
                    background: elapsed || playing
                      ? elapsed
                        ? 'var(--nimi-text-primary)'
                        : 'color-mix(in srgb, var(--nimi-text-primary) 55%, transparent)'
                      : `color-mix(in srgb, var(--nimi-text-primary) ${idleAlpha}%, transparent)`,
                    animation: playing
                      ? `char-voice-wave-pulse 1.1s ease-in-out ${index * -0.08}s infinite`
                      : undefined,
                  }}
                />
              );
            })}
          </span>
        ) : null}
        {durationText ? (
          <span className="shrink-0 text-[11px] font-medium leading-none tabular-nums text-[var(--nimi-text-muted)]">
            {durationText}
          </span>
        ) : null}
        <span className="sr-only">
          {t('SourceDetail.worldCharacter.voicePreview', { defaultValue: 'Voice preview' })}
        </span>
      </button>
    </span>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r033
// One layout serves both source kinds. Optional sections use authored data;
// names, species and narrative prose never choose a character-specific template.
export function CharacterSourceDetailPage(props: CharacterSourceDetailPageProps) {
  const { t } = useTranslation();
  const { source } = props;
  const partner = props.partner;
  const profile = source.characterProfile;

  // Prefer the character's own cover over the shared World banner when authored.
  const bannerMedia = source.profileCoverMedia ?? source.worldBannerMedia ?? source.referenceImageMedia;
  const bannerUrl = source.profileCoverUrl ?? source.worldBannerUrl ?? source.referenceImageUrl;
  const heroRole = worldCharacterHeroDescription(source, t);
  const heroTraits = worldCharacterHeroTraits(source, t);

  const voiceSample = source.voiceSample;
  const voiceDurationSec = voiceSample?.durationSec != null && Number.isFinite(voiceSample.durationSec)
    ? Math.max(0, Math.round(voiceSample.durationSec)) : null;
  const voiceDurationText = voiceDurationSec != null
    ? t('SourceDetail.worldCharacter.voicePreviewDuration', { seconds: voiceDurationSec }) : null;
  const voiceTranscript = voiceSample?.transcript?.trim() || voiceSample?.previewText?.trim() || null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [voiceFailed, setVoiceFailed] = useState(false);

  const toggleVoice = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setVoiceFailed(false);
    if (voicePlaying) {
      audio.pause();
      return;
    }
    const playback = audio.play();
    if (playback && typeof playback.catch === 'function') {
      void playback.catch(() => {
        setVoicePlaying(false);
        setVoiceFailed(true);
      });
    }
  };

  // Reveal a compact sticky header once the hero action bar scrolls above the
  // ScrollArea viewport top edge. Comparing directly against the ScrollArea
  // viewport avoids the dead zone created by desktop titlebar chrome above the
  // scroll container when IntersectionObserver defaults to the window viewport.
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const heroHeaderRef = useRef<HTMLDivElement | null>(null);
  const heroSentinelRef = useRef<HTMLDivElement | null>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  useEffect(() => {
    if (partner) {
      setStickyVisible(false);
      return;
    }
    const viewport = scrollViewportRef.current;
    const sentinel = heroSentinelRef.current;
    if (!viewport || !sentinel) return;

    const updateStickyVisibility = () => {
      const viewportRect = viewport.getBoundingClientRect();
      if (viewportRect.height <= 0) {
        setStickyVisible(false);
        return;
      }
      const sentinelRect = sentinel.getBoundingClientRect();
      const nextVisible = sentinelRect.bottom <= viewportRect.top;
      setStickyVisible((prev) => (prev === nextVisible ? prev : nextVisible));
    };

    updateStickyVisibility();
    viewport.addEventListener('scroll', updateStickyVisibility, { passive: true });
    const ownerWindow = viewport.ownerDocument?.defaultView;
    ownerWindow?.addEventListener('resize', updateStickyVisibility);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateStickyVisibility);
      resizeObserver.observe(viewport);
      if (heroHeaderRef.current) {
        resizeObserver.observe(heroHeaderRef.current);
      }
    }

    return () => {
      viewport.removeEventListener('scroll', updateStickyVisibility);
      ownerWindow?.removeEventListener('resize', updateStickyVisibility);
      resizeObserver?.disconnect();
    };
  }, [partner, source.sourceId, source.sourceHash]);

  const meetingScene = profile.interaction?.scenario?.trim();
  const hasDialogue = Boolean(profile.dialogueExemplars?.length || profile.interaction?.greeting?.trim());
  const hasMeeting = Boolean(profile.interaction?.meetingScenes?.length || meetingScene || hasDialogue);
  const lifeEvents = profile.milestones.filter(milestone => milestone.kind !== 'work');
  const relationships = buildRelationshipClueItems(source, t);
  const hasPeople = relationships.some(item => item.group === 'people');
  const hasLifeOrObjects = relationships.some(item => item.group === 'life' || item.group === 'objects');
  const hasGuidance = hasCharacterGuidanceContent(source);
  const hasSpecs = hasCharacterProfileSpecs(source);

  const hasStageColumn = Boolean(
    characterAboutParagraphs(source).length
    || hasMeeting
    || lifeEvents.length
    || partner?.sourceNotice,
  );
  const hasDossierColumn = Boolean(
    partner?.status
    || hasGuidance
    || hasSpecs
    || hasPeople
    || hasLifeOrObjects,
  );
  const dualColumn = hasStageColumn && hasDossierColumn;

  const displayName = partner?.displayName ?? source.displayName;
  const avatarUrl = partner ? partner.avatarUrl : source.avatarUrl;
  const avatarMedia = partner ? undefined : source.avatarMedia;

  const pageContent = (
    <>
      {!partner && stickyVisible ? (
        <div className="sticky top-0 z-20 h-0 overflow-visible">
          <div
            data-testid="world-character-sticky-bar"
            className="border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_96%,transparent)]"
          >
            <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-8 py-2.5 max-[720px]:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <EntityAvatar
                  imageUrl={avatarUrl}
                  media={avatarMedia}
                  name={displayName}
                  kind="human"
                  shape="rounded"
                  sizeClassName="h-7 w-7 shrink-0"
                  radiusClassName="rounded-[var(--nimi-radius-sm)]"
                  fallbackClassName="bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)]"
                  textClassName="text-xs font-semibold"
                />
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{displayName}</p>
                  {heroRole ? <p className="hidden truncate text-xs text-[var(--nimi-text-muted)] sm:block">{heroRole}</p> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {voiceSample ? (
                  <WorldCharacterVoicePill
                    compact
                    playing={voicePlaying}
                    progress={voiceProgress}
                    durationText={voiceDurationText}
                    onToggle={toggleVoice}
                  />
                ) : null}
                <CharacterActions {...props} compact />
              </div>
            </div>
          </div>
        </div>
      ) : null}

        <section data-testid="world-character-overview-section" data-nimi-density="expressive" className="min-w-0">
          <div className={`mx-auto w-full max-w-[1120px] ${partner ? 'px-0' : 'px-8 pt-6 max-[720px]:px-5 max-[720px]:pt-4'}`}>
            <div
              data-testid="world-character-hero-banner"
              className={`relative w-full overflow-hidden rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] ring-1 ring-inset ring-black/[0.06] ${partner ? 'h-[176px]' : 'h-[240px] max-[720px]:h-[176px]'}`}
            >
              {bannerMedia || bannerUrl ? (
                <>
                  <MediaImage
                    delivery={bannerMedia}
                    externalUrl={bannerUrl}
                    purpose="hero"
                    sizes="auto, 1120px"
                    loading="eager"
                    fetchPriority="high"
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover object-[center_22%]"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/24 to-transparent"
                  />
                </>
              ) : null}
              {source.worldId && source.worldName ? (
                <button
                  type="button"
                  data-testid="world-character-world-pill"
                  onClick={props.onOpenWorld}
                  className="absolute right-4 top-4 z-10 inline-flex max-w-[min(360px,68%)] items-center gap-1.5 rounded-[10px] bg-black/62 px-3 py-1.5 text-white transition-colors hover:bg-black/78 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                >
                  <Globe aria-hidden className="h-3.5 w-3.5 shrink-0 text-white/75" />
                  <span className="shrink-0 text-xs text-white/75">{t('SourceDetail.worldCharacter.worldPill')}</span>
                  <span className="min-w-0 truncate text-xs font-medium text-white">{source.worldName}</span>
                  <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-white/75" />
                </button>
              ) : null}
            </div>
          </div>

          <div className={`mx-auto max-w-[1120px] pb-12 ${partner ? 'px-0' : 'px-8 max-[720px]:px-5'}`}>
            <div ref={heroHeaderRef} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-6 gap-y-4 max-[760px]:grid-cols-[auto_minmax(0,1fr)] ${partner ? 'pl-6 max-[720px]:pl-5' : 'pl-8 max-[720px]:pl-5'}`}>
              <div
                data-testid="world-character-hero-avatar"
                className={`char-hero-avatar relative shrink-0 overflow-hidden rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-card)] ${partner ? '-mt-12 h-24 w-24' : '-mt-16 h-32 w-32 max-[720px]:-mt-10 max-[720px]:h-22 max-[720px]:w-22'}`}
              >
                <EntityAvatar
                  imageUrl={avatarUrl}
                  media={avatarMedia}
                  name={displayName}
                  kind="human"
                  shape="rounded"
                  sizeClassName="h-full w-full"
                  radiusClassName="rounded-[var(--nimi-radius-lg)]"
                  fallbackClassName="bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)]"
                  textClassName="char-display-serif text-3xl"
                />
              </div>

              <div className="min-w-0 pt-4 max-[760px]:pt-2">
                <div data-testid="world-character-hero-title-row" className="flex flex-wrap items-center gap-3">
                  <h1 className={`char-display-serif break-words leading-[1.2] text-[var(--nimi-text-primary)] ${partner ? 'text-[28px]' : 'text-[36px] max-[720px]:text-[28px]'}`}>
                    {displayName}
                  </h1>
                  {voiceSample ? (
                    <WorldCharacterVoicePill
                      playing={voicePlaying}
                      progress={voiceProgress}
                      durationText={voiceDurationText}
                      onToggle={toggleVoice}
                    />
                  ) : null}
                </div>

                {heroRole ? (
                  <p data-testid="world-character-hero-role" className="mt-1.5 max-w-[58ch] text-[15px] font-medium leading-6 text-[var(--nimi-text-primary)]">
                    {heroRole}
                  </p>
                ) : null}

                {heroTraits.length ? (
                  <p data-testid="world-character-hero-traits" className="mt-1 text-[13px] leading-5 text-[var(--nimi-text-muted)]">
                    {heroTraits.join(' · ')}
                  </p>
                ) : null}

                {voiceTranscript && voicePlaying ? (
                  <p
                    data-testid="world-character-voice-transcript"
                    role="status"
                    className="mt-2 max-w-[54ch] text-[13px] leading-6 text-[var(--nimi-text-secondary)]"
                  >
                    “{voiceTranscript}”
                  </p>
                ) : null}

                {voiceFailed ? (
                  <p role="status" className="mt-2 text-xs text-[var(--nimi-status-danger)]">
                    {t('SourceDetail.worldCharacter.voicePlaybackError', { defaultValue: "Couldn't play voice preview" })}
                  </p>
                ) : null}
              </div>

              <div className="pt-4 max-[760px]:col-span-full max-[760px]:pt-1">
                {partner ? partner.actions : <CharacterActions {...props} />}
              </div>
            </div>

            <div ref={heroSentinelRef} data-testid="world-character-hero-sentinel" aria-hidden="true" className="h-px w-full" />

            {!partner && source.visualGallery.length > 0 ? (
              <CharacterVisualGallery
                characterName={source.displayName}
                items={source.visualGallery}
              />
            ) : null}

            {hasStageColumn || hasDossierColumn ? (
              <div
                data-testid="world-character-overview-columns"
                className="mt-10"
              >
                <div
                  data-testid="world-character-reading-columns"
                  className={`grid items-start gap-12 ${dualColumn ? 'min-[960px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]' : 'max-w-[680px]'}`}
                >
                  {hasStageColumn ? (
                    <div data-testid="world-character-stage-column" className="grid min-w-0 content-start gap-10">
                      {partner?.sourceNotice ? <div>{partner.sourceNotice}</div> : null}
                      <CharacterAboutSection source={source} />
                      {hasMeeting ? (
                        partner ? (
                          <details
                            data-testid="world-character-partner-meeting-reference"
                            className="group rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] p-6"
                          >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-semibold text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden">
                              <span>{t('runtimeConfig.partners.meetingReference')}</span>
                              <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-[var(--nimi-text-muted)] transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                            </summary>
                            <div className="mt-5 border-t border-[var(--nimi-border-subtle)] pt-5">
                              <CharacterFirstMeeting source={source} />
                            </div>
                          </details>
                        ) : (
                          <div
                            data-testid="world-character-interaction-stage"
                            className="rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] p-6"
                          >
                            <CharacterFirstMeeting source={source} />
                          </div>
                        )
                      ) : null}
                      <CharacterLifeEventsSection lifeEvents={lifeEvents} />
                    </div>
                  ) : null}

                  {hasDossierColumn ? (
                    <aside
                      data-testid="world-character-dossier-column"
                      className="grid min-w-0 content-start gap-6 rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] p-6 sm:p-7"
                    >
                      {partner?.status ? <div className="char-folio-section">{partner.status}</div> : null}
                      <CharacterProfileSpecsCard source={source} />
                      <CharacterGuidanceCard source={source} />
                      <WorldCharacterRelationshipCluesSection source={source} />
                      <WorldCharacterBackgroundSections source={source} />
                    </aside>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className={`mx-auto max-w-[1120px] ${partner ? 'px-0' : 'px-8 max-[720px]:px-5'}`}>
          <WorldCharacterWorksBlock source={source} />
        </div>
    </>
  );

  return (
    <div data-testid="character-source-detail-page" data-source-kind={source.sourceKind} className="char-profile-root flex min-h-0 flex-1 flex-col">
      {voiceSample ? (
        <audio
          key={voiceSample.previewUrl}
          ref={audioRef}
          data-testid="world-character-voice-sample-audio"
          className="hidden"
          preload="none"
          src={voiceSample.previewUrl}
          onPlay={() => { setVoicePlaying(true); setVoiceFailed(false); }}
          onPause={() => setVoicePlaying(false)}
          onEnded={() => { setVoicePlaying(false); setVoiceProgress(0); }}
          onTimeUpdate={(event) => {
            const el = event.currentTarget;
            if (el.duration && Number.isFinite(el.duration) && el.duration > 0) {
              setVoiceProgress(Math.min(1, Math.max(0, el.currentTime / el.duration)));
            }
          }}
          onError={() => { setVoicePlaying(false); setVoiceFailed(true); }}
        />
      ) : null}

      {partner ? (
        <div className="min-w-0 flex-1">
          {pageContent}
        </div>
      ) : (
        <ScrollArea viewportRef={scrollViewportRef} className="min-w-0 flex-1">
          {pageContent}
        </ScrollArea>
      )}
    </div>
  );
}
