import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { ArrowLeft, CirclePlus, MessageCircle } from 'lucide-react';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { describeRealmPersonaPrimaryAction } from '@renderer/features/explore/realm-persona-source-materialization';
import type { SourceDetailData } from './source-detail-model.js';
import { simplifySourceDetailChineseText as simplifyDisplayText } from './source-detail-simplified-chinese.js';
import { ScoreProgressBar } from './source-detail-view-primitives.js';
import {
  milestoneKindLabel,
  milestoneTheme,
  sceneRefLabel,
  topicChips,
  uniqueStrings,
  workStatusLabel,
  worldCharacterHeroSubtitle,
  worldCharacterPrimaryActionLabel,
  WorldCharacterRelationshipCluesSection,
} from './source-detail-world-character-presentation.js';

type WorldCharacterSourceDetailPageProps = {
  source: SourceDetailData;
  stats?: { friendsCount: number; postsCount: number; likesCount: number } | null;
  worldScore?: number;
  onBack: () => void;
  onOpenWorld: () => void;
  onPrimaryAction: () => void;
  onStartChat?: () => void;
  onSendGift: () => void;
};

function WorldCharacterIdentityCoordinates({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const character = source.worldCharacter;
  if (!character) {
    return null;
  }
  const coordinates = [
    {
      label: t('SourceDetail.worldCharacter.identityRole', { defaultValue: 'Role' }),
      value: character.role,
    },
    {
      label: t('SourceDetail.worldCharacter.identityFaction', { defaultValue: 'Faction' }),
      value: character.faction,
    },
    {
      label: t('SourceDetail.worldCharacter.identityRank', { defaultValue: 'Rank' }),
      value: character.rank,
    },
    {
      label: t('SourceDetail.worldCharacter.identityScenes', { defaultValue: 'Scenes' }),
      value: character.sceneRefs.length > 0 ? character.sceneRefs.map(sceneRefLabel).join(' / ') : null,
    },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));

  if (coordinates.length === 0) {
    return null;
  }

  return (
    <div data-testid="world-character-identity-coordinates" className="mt-5">
      <h3 className="text-sm font-semibold text-[#262017]">
        {t('SourceDetail.worldCharacter.identityCoordinatesTitle', { defaultValue: 'Identity coordinates' })}
      </h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {coordinates.map((item) => (
          <div key={item.label} className="rounded-[12px] border border-[#e9e1d0] bg-[#fffdf8] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-normal text-[#7a7060]">{item.label}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#262017]">{simplifyDisplayText(item.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorldCharacterWorksSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  return (
    <section data-testid="world-character-works-section" className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-[#1d5f43]">
            {t('SourceDetail.worldCharacter.worksEyebrow', { defaultValue: 'Related reading' })}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[#262017]">
            {t('SourceDetail.works.title', { defaultValue: 'Works collections' })}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#7a7060]">
            {source.works.length > 0
              ? t('SourceDetail.works.count', {
                  count: source.works.length,
                  defaultValue: '{{count}} related works collected',
                })
              : t('SourceDetail.works.unavailable', {
                  defaultValue: 'Works collection data is not available for this source yet.',
                })}
          </p>
        </div>
        <span className="rounded-full bg-[#eef5ef] px-3 py-1 text-xs font-semibold text-[#1d5f43]">
          {t('SourceDetail.works.badge', { defaultValue: 'Texts' })}
        </span>
      </div>

      {source.works.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {source.works.map((work) => (
            <article key={work.id} className="rounded-[14px] border border-[#e9e1d0] bg-[#fffdf8] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-[#262017]">{simplifyDisplayText(work.title)}</h3>
                  {work.romanizedTitle ? (
                    <p className="mt-1 text-xs text-[#7a7060]">{simplifyDisplayText(work.romanizedTitle)}</p>
                  ) : null}
                  {work.timeLabel ? (
                    <p className="mt-1 text-xs font-semibold text-[#1d5f43]">{simplifyDisplayText(work.timeLabel)}</p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-[#f1eee6] px-2 py-0.5 text-[11px] font-medium text-[#7a7060]">
                  {workStatusLabel(work.status, t)}
                </span>
              </div>
              {work.summary ? (
                <p className="mt-3 text-sm leading-6 text-[#7a7060]">{simplifyDisplayText(work.summary)}</p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WorldCharacterMilestonesSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const milestones = source.worldCharacter?.milestones ?? [];
  if (milestones.length === 0) {
    return null;
  }

  return (
    <section data-testid="world-character-milestones-section" className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
      <p className="text-xs font-semibold uppercase tracking-normal text-[#1d5f43]">
        {t('SourceDetail.worldCharacter.milestonesEyebrow', { defaultValue: 'Biography' })}
      </p>
      <h2 className="mt-1 text-xl font-semibold text-[#262017]">
        {t('SourceDetail.worldCharacter.milestonesTitle', { defaultValue: 'Life milestones' })}
      </h2>
      <div data-testid="world-character-milestones-timeline" className="relative mt-5 grid gap-0">
        <div aria-hidden="true" className="absolute bottom-4 left-[5.75rem] top-4 w-px bg-[#ddd2ba] max-[620px]:left-[4.65rem]" />
        {milestones.map((milestone) => {
          const theme = milestoneTheme(milestone);
          const badgeStyle: CSSProperties = {
            background: theme.softBg,
            color: theme.ink,
          };
          const dotStyle: CSSProperties = {
            background: milestone.derived ? theme.accent : '#eef5ef',
            color: milestone.derived ? '#fffaf0' : '#1d5f43',
          };
          return (
            <article
              key={milestone.id}
              data-testid={milestone.derived ? 'world-character-career-derived-node' : undefined}
              className="relative grid grid-cols-[88px_24px_minmax(0,1fr)] gap-3 py-3 max-[620px]:grid-cols-[70px_22px_minmax(0,1fr)]"
            >
              <div className="pt-3 text-right">
                {milestone.timeLabel ? (
                  <span className="block text-sm font-semibold tabular-nums text-[#1d5f43]">
                    {simplifyDisplayText(milestone.timeLabel)}
                  </span>
                ) : null}
              </div>
              <div className="relative z-10 flex justify-center pt-2">
                <span style={dotStyle} className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold shadow-[0_0_0_4px_#fbf8f1]">
                  {milestone.derived
                    ? milestone.kind === 'work' ? '文' : milestone.kind === 'office' ? '官' : '仕'
                    : milestone.sequence ?? '生'}
                </span>
              </div>
              <div className="min-w-0 rounded-[14px] border border-[#e9e1d0] bg-[#fffdf8] p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold leading-6 text-[#262017]">{simplifyDisplayText(milestone.title)}</h3>
                    <span style={badgeStyle} className="rounded-full px-2 py-0.5 text-[11px] font-semibold">
                      {milestoneKindLabel(milestone, t)}
                    </span>
                  </div>
                  {milestone.summary && milestone.summary !== milestone.title ? (
                    <p className="mt-1 text-sm leading-6 text-[#7a7060]">{simplifyDisplayText(milestone.summary)}</p>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function WorldCharacterConversationSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const anchors = uniqueStrings([
    ...(source.worldCharacter?.conversationAnchors ?? []),
    ...source.relationshipClues.map((clue) => clue.label),
    ...source.works.map((work) => work.title),
    ...topicChips(source),
  ].map(simplifyDisplayText)).slice(0, 8);

  return (
    <section className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
      <h2 className="text-lg font-semibold text-[#262017]">
        {t('SourceDetail.worldCharacter.talkTitle', { defaultValue: 'Conversation ideas' })}
      </h2>
      {anchors.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {anchors.map((anchor) => (
            <p key={anchor} className="rounded-[12px] bg-[#eef5ef] px-3 py-2 text-xs font-semibold leading-5 text-[#1d5f43]">
              {anchor}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-[#7a7060]">
          {t('SourceDetail.worldCharacter.noAnchors', { defaultValue: 'No conversation ideas are available yet.' })}
        </p>
      )}
    </section>
  );
}

function WorldCharacterInteractionSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const interaction = source.worldCharacter?.interaction;
  if (!interaction) {
    return null;
  }
  const items = [
    {
      label: t('SourceDetail.worldCharacter.greeting', { defaultValue: 'Greeting' }),
      value: interaction.greeting ? simplifyDisplayText(interaction.greeting) : null,
    },
    {
      label: t('SourceDetail.worldCharacter.tone', { defaultValue: 'Tone' }),
      value: interaction.tone ? simplifyDisplayText(interaction.tone) : null,
    },
    {
      label: t('SourceDetail.worldCharacter.cadence', { defaultValue: 'Cadence' }),
      value: interaction.cadence ? simplifyDisplayText(interaction.cadence) : null,
    },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
      <h2 className="text-lg font-semibold text-[#262017]">
        {t('SourceDetail.worldCharacter.interactionTitle', { defaultValue: 'Opening voice' })}
      </h2>
      <div className="mt-3 grid gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <p className="text-[11px] font-semibold uppercase tracking-normal text-[#7a7060]">{item.label}</p>
            <p className="mt-1 text-sm leading-6 text-[#4a4336]">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorldCharacterMediaSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const referenceImageUrl = source.referenceImageUrl;
  const voiceSample = source.voiceSample;
  const voiceDuration = typeof voiceSample?.durationSec === 'number' && Number.isFinite(voiceSample.durationSec)
    ? Math.round(voiceSample.durationSec)
    : null;

  if (!referenceImageUrl && !voiceSample) {
    return null;
  }

  return (
    <section data-testid="world-character-media-section" className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
      <p className="text-xs font-semibold uppercase tracking-normal text-[#1d5f43]">
        {t('SourceDetail.worldCharacter.mediaEyebrow', { defaultValue: 'Media' })}
      </p>
      <h2 className="mt-1 text-lg font-semibold text-[#262017]">
        {t('SourceDetail.worldCharacter.mediaTitle', { defaultValue: 'Character media' })}
      </h2>

      {referenceImageUrl ? (
        <div
          data-testid="world-character-reference-image"
          className="mx-auto mt-4 flex aspect-[2/3] w-full max-w-[320px] items-center justify-center overflow-hidden rounded-[14px] border border-[#e9e1d0] bg-[#fffdf8] p-2"
        >
          <img
            src={referenceImageUrl}
            alt=""
            className="h-full w-full object-contain"
          />
        </div>
      ) : null}

      {voiceSample ? (
        <div data-testid="world-character-voice-sample" className="mt-4 rounded-[14px] border border-[#e9e1d0] bg-[#fffdf8] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-normal text-[#7a7060]">
            {t('SourceDetail.worldCharacter.voiceSample', { defaultValue: 'Voice sample' })}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#7a7060]">
            {voiceSample.mimeType ?? t('SourceDetail.worldCharacter.voiceReady', { defaultValue: 'Ready audio resource' })}
            {voiceDuration ? ` · ${voiceDuration}s` : ''}
          </p>
          <audio
            data-testid="world-character-voice-sample-audio"
            className="mt-3 w-full"
            controls
            preload="metadata"
            src={voiceSample.url}
          />
        </div>
      ) : null}
    </section>
  );
}

export function WorldCharacterSourceDetailPage(props: WorldCharacterSourceDetailPageProps) {
  const { t } = useTranslation();
  const { source } = props;
  const bannerUrl = source.profileCoverUrl ?? source.worldBannerUrl ?? source.referenceImageUrl;
  const primaryAction = describeRealmPersonaPrimaryAction(source.sourceState);
  const chips = topicChips(source);
  const subtitle = worldCharacterHeroSubtitle(source);

  return (
    <div data-testid="world-character-source-detail-page" className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <ScrollArea
        className="flex-1 bg-gray-50"
        viewportClassName="bg-gray-50"
        contentClassName="mx-auto max-w-[1180px] px-5 py-6"
      >
        <div className="grid gap-5">
          <section
            className="relative h-[410px] overflow-hidden rounded-[24px] border border-[#e8eae7] shadow-[0_10px_30px_rgba(30,41,38,.10)] max-[900px]:h-[440px] max-[720px]:h-[560px]"
            style={{
              backgroundImage: bannerUrl
                ? `url(${bannerUrl})`
                : 'linear-gradient(135deg, #cfe3d6 0%, #bacfc0 52%, #e7ede6 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <button
              type="button"
              data-testid="world-character-back-button"
              onClick={props.onBack}
              aria-label={t('Common.back', { defaultValue: 'Back' })}
              className="absolute left-14 top-7 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/68 text-[#33423b] shadow-[0_10px_24px_rgba(30,41,38,.10)] backdrop-blur-[4px] transition hover:bg-white/86 hover:text-[#1f6844] max-[900px]:left-8"
            >
              <ArrowLeft aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </button>

            <div className="absolute bottom-12 left-14 z-10 max-w-[620px] max-[1040px]:left-8 max-[1040px]:bottom-9 max-[1040px]:max-w-[430px] max-[720px]:bottom-[184px] max-[720px]:right-8">
              <div className="flex items-end gap-5">
                <div
                  data-testid="world-character-hero-avatar"
                  className="relative h-[104px] w-[104px] shrink-0 overflow-hidden rounded-[20px] bg-white"
                  style={{ boxShadow: '0 0 0 4px #ffffff, 0 0 0 5px rgba(47,157,120,.30), 0 12px 26px rgba(32,52,45,.16)' }}
                >
                  <EntityAvatar
                    imageUrl={source.avatarUrl}
                    name={simplifyDisplayText(source.displayName)}
                    kind="human"
                    shape="rounded"
                    sizeClassName="h-full w-full"
                    radiusClassName="rounded-[18px]"
                    fallbackClassName="bg-[#e7f2ec] text-[#1d7a4f]"
                    textClassName="text-3xl font-semibold"
                  />
                </div>
                <div className="min-w-0 pb-1">
                  <h1 className="text-[52px] font-semibold leading-[1.04] tracking-normal text-[#1b211d] [text-shadow:0_1px_3px_rgba(255,255,255,.5)] max-[900px]:text-[40px]">
                    {simplifyDisplayText(source.displayName)}
                  </h1>
                  {subtitle ? (
                    <p className="mt-2 max-w-[440px] truncate text-[15px] text-[#5b645e] [text-shadow:0_1px_2px_rgba(255,255,255,.5)]">{simplifyDisplayText(subtitle)}</p>
                  ) : null}
                </div>
              </div>

              {chips.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {chips.slice(0, 6).map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full bg-white/65 px-3 py-1 text-xs font-medium text-[#4c554f] backdrop-blur-[2px]"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div
              className="absolute bottom-14 right-12 z-10 w-[370px] rounded-[18px] border border-white/62 px-5 py-4 max-[1040px]:bottom-9 max-[1040px]:right-8 max-[1040px]:w-[342px] max-[720px]:bottom-6 max-[720px]:left-8 max-[720px]:right-8 max-[720px]:w-auto"
              style={{
                background: 'rgba(244,237,224,0.76)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow: '0 16px 36px rgba(34,26,18,0.18), inset 0 1px 0 rgba(255,255,255,0.52)',
              }}
            >
              {props.stats ? (
                <div className="flex items-center justify-center gap-4 text-center">
                  <p className="text-[13px] font-semibold text-[#20342d]">
                    <span className="text-[16px]">{props.stats.friendsCount}</span>
                    <span className="ml-1 text-[#2f3a34]">{t('SourceDetail.friends', { defaultValue: 'Friends' })}</span>
                  </p>
                  <span className="h-1 w-1 rounded-full bg-white/78" aria-hidden />
                  <p className="text-[13px] font-semibold text-[#20342d]">
                    <span className="text-[16px]">{props.stats.postsCount}</span>
                    <span className="ml-1 text-[#2f3a34]">{t('SourceDetail.posts', { defaultValue: 'Posts' })}</span>
                  </p>
                  <span className="h-1 w-1 rounded-full bg-white/78" aria-hidden />
                  <p className="text-[13px] font-semibold text-[#20342d]">
                    <span className="text-[16px]">{props.stats.likesCount}</span>
                    <span className="ml-1 text-[#2f3a34]">{t('SourceDetail.likes', { defaultValue: 'Likes' })}</span>
                  </p>
                </div>
              ) : null}
              <div className={`grid grid-cols-2 gap-4 max-[420px]:grid-cols-1 ${props.stats ? 'mt-5' : ''}`}>
                <button
                  type="button"
                  onClick={props.onStartChat}
                  disabled={primaryAction.disabled || !props.onStartChat}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[12px] bg-[#078a55] px-4 text-[15px] font-semibold text-white shadow-[0_10px_24px_rgba(7,138,85,.24)] transition hover:bg-[#067a4c] disabled:cursor-default disabled:opacity-60"
                >
                  <MessageCircle aria-hidden className="h-[16px] w-[16px]" strokeWidth={2.2} />
                  {t('SourceDetail.worldCharacter.chatNow', { defaultValue: 'Chat now' })}
                </button>
                <button
                  type="button"
                  onClick={props.onPrimaryAction}
                  disabled={primaryAction.disabled}
                  data-source-state={source.sourceState}
                  data-primary-action={primaryAction.action}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[12px] border border-white/70 bg-white/78 px-4 text-[15px] font-semibold text-[#1d5f43] shadow-[0_8px_20px_rgba(34,26,18,.08)] transition hover:bg-white disabled:cursor-default disabled:opacity-60"
                >
                  <CirclePlus aria-hidden className="h-[16px] w-[16px]" strokeWidth={2.2} />
                  {worldCharacterPrimaryActionLabel(primaryAction, t)}
                </button>
              </div>
              <p className="mt-3 text-center text-xs font-medium text-[#7a7060]">
                {t('SourceDetail.worldCharacter.joinLocalHint', { defaultValue: 'Join to keep chatting locally.' })}
              </p>
            </div>
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)_330px] gap-5 max-[980px]:grid-cols-1">
            <main className="grid min-w-0 gap-5">
              <section className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-normal text-[#1d5f43]">{t('SourceDetail.worldCharacter.profileEyebrow', { defaultValue: 'Profile' })}</p>
                    <h2 className="mt-1 text-xl font-semibold text-[#262017]">{t('SourceDetail.worldCharacter.overviewTitle', { defaultValue: 'Character overview' })}</h2>
                  </div>
                  {source.worldId ? (
                    <button
                      type="button"
                      onClick={props.onOpenWorld}
                      className="rounded-[10px] border border-[#d6c9ac] bg-[#fffdf8] px-3 py-2 text-xs font-semibold text-[#1d5f43]"
                    >
                      {t('SourceDetail.openWorld', { defaultValue: 'Open World' })}
                    </button>
                  ) : null}
                </div>
                {source.entity?.summary ? (
                  <p className="mt-4 text-sm leading-7 text-[#4a4336]">{simplifyDisplayText(source.entity.summary)}</p>
                ) : null}
                <WorldCharacterIdentityCoordinates source={source} />
              </section>

              <WorldCharacterMilestonesSection source={source} />
              <WorldCharacterWorksSection source={source} />
              <WorldCharacterRelationshipCluesSection source={source} />
            </main>

            <aside className="grid content-start gap-5">
              <WorldCharacterMediaSection source={source} />
              <WorldCharacterConversationSection source={source} />
              <WorldCharacterInteractionSection source={source} />

              <section className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
                <h2 className="text-lg font-semibold text-[#262017]">{t('SourceDetail.score', { defaultValue: 'Score' })}</h2>
                <div className="mt-4 flex items-center gap-3">
                  <ScoreProgressBar score={props.worldScore} />
                  <span className="text-sm font-semibold text-[#262017]">{Math.round(Math.min(100, Math.max(0, props.worldScore ?? 0)))}</span>
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={props.onSendGift}
                    className="rounded-[10px] border border-[#d6c9ac] bg-[#fffdf8] px-3 py-2 text-xs font-semibold text-[#3b3527]"
                  >
                    {t('SourceDetail.sendGift', { defaultValue: 'Send Gift' })}
                  </button>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
