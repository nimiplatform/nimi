import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, Tooltip, TooltipProvider } from '@nimiplatform/kit/ui';
import { ArrowLeft, CirclePlus, MessageCircle } from 'lucide-react';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { toSafeBackgroundImage } from '@renderer/features/explore/explore-background-image.js';
import { describeCharacterPrimaryAction } from '@renderer/features/explore/character-source-materialization';
import type { SourceDetailData, SourceDetailWorldCharacterMilestone } from './source-detail-model.js';
import { simplifySourceDetailChineseText as simplifyDisplayText } from './source-detail-simplified-chinese.js';
import {
  biographicalTimelineMarker,
  buildSourceDetailBiographicalTimeline,
  type SourceDetailBiographicalTimelineSection,
} from './source-detail-world-character-biographical-timeline.js';
import {
  sceneRefLabel,
  topicChips,
  worldCharacterHeroDescription,
  worldCharacterHeroSubtitle,
  worldCharacterPrimaryActionLabel,
} from './source-detail-world-character-labels.js';
import { WorldCharacterRelationshipCluesSection } from './source-detail-world-character-relationship-map.js';
import {
  milestoneKindLabel,
  milestoneTheme,
} from './source-detail-world-character-theme.js';

type WorldCharacterSourceDetailPageProps = {
  source: SourceDetailData;
  stats?: { friendsCount: number; postsCount: number; likesCount: number } | null;
  onBack: () => void;
  onOpenWorld: () => void;
  onPrimaryAction: () => void;
  onStartChat?: (initialComposerText?: string) => void;
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
          <h2 className="text-xl font-semibold text-[#262017]">
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

function WorldCharacterMilestoneCard({
  milestone,
  compact = false,
}: {
  readonly milestone: SourceDetailWorldCharacterMilestone;
  readonly compact?: boolean;
}) {
  const { t } = useTranslation();
  const theme = milestoneTheme(milestone);
  const badgeStyle: CSSProperties = {
    background: theme.softBg,
    color: theme.ink,
  };
  return (
    <div className={compact ? 'min-w-0 rounded-[12px] border border-[#eadfca] bg-[#fffaf0] px-3 py-2' : 'min-w-0 rounded-[14px] border border-[#e9e1d0] bg-[#fffdf8] p-4'}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 className={compact ? 'text-sm font-semibold leading-6 text-[#3a2b18]' : 'text-sm font-semibold leading-6 text-[#262017]'}>
          {simplifyDisplayText(milestone.title)}
        </h3>
        <span style={badgeStyle} className="rounded-full px-2 py-0.5 text-[11px] font-semibold">
          {milestoneKindLabel(milestone, t)}
        </span>
      </div>
      {milestone.summary && milestone.summary !== milestone.title ? (
        <p className={compact ? 'mt-0.5 text-sm leading-6 text-[#7a7060]' : 'mt-1 text-sm leading-6 text-[#7a7060]'}>
          {simplifyDisplayText(milestone.summary)}
        </p>
      ) : null}
    </div>
  );
}

function WorldCharacterSecondaryClues({
  clues,
}: {
  readonly clues: readonly SourceDetailWorldCharacterMilestone[];
}) {
  if (clues.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 grid gap-2 border-t border-[#eee3ce] pt-3">
      {clues.map((clue) => (
        <div key={clue.id} data-testid="world-character-biography-secondary-clue" className="grid grid-cols-[4px_minmax(0,1fr)] gap-3">
          <span aria-hidden="true" className="mt-3 h-1.5 w-1.5 rounded-full bg-[#c9973c]" />
          <WorldCharacterMilestoneCard milestone={clue} compact />
        </div>
      ))}
    </div>
  );
}

function WorldCharacterClueList({
  section,
}: {
  readonly section: Extract<SourceDetailBiographicalTimelineSection, { kind: 'clueList' }>;
}) {
  const { t } = useTranslation();
  const isAllClueList = section.variant === 'all';
  const title = isAllClueList
    ? t('SourceDetail.worldCharacter.biographyCluesAll', { defaultValue: 'Biography clues' })
    : t('SourceDetail.worldCharacter.biographyCluesUndated', { defaultValue: 'Undated clues' });
  return (
    <div
      data-testid={isAllClueList ? 'world-character-biography-clue-list' : 'world-character-biography-unmatched-clues'}
      className={`${isAllClueList ? '' : 'ml-[7.75rem] max-[620px]:ml-0'} grid gap-2 rounded-[14px] border border-dashed border-[#decda8] bg-[#fffaf0] p-3`}
    >
      <p className="text-xs font-semibold text-[#8b641d]">{title}</p>
      <div className="grid gap-2">
        {section.clues.map((clue) => (
          <WorldCharacterMilestoneCard key={clue.id} milestone={clue} compact />
        ))}
      </div>
    </div>
  );
}

function WorldCharacterMilestonesSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const milestones = source.worldCharacter?.milestones ?? [];
  const sections = buildSourceDetailBiographicalTimeline(milestones);
  if (sections.length === 0) {
    return null;
  }

  return (
    <section data-testid="world-character-milestones-section" className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
      <h2 className="text-xl font-semibold text-[#262017]">
        {t('SourceDetail.worldCharacter.milestonesTitle', { defaultValue: 'Life milestones' })}
      </h2>
      <div data-testid="world-character-milestones-timeline" className="relative mt-5 grid gap-3">
        {sections.some((section) => section.kind === 'primary') ? (
          <div aria-hidden="true" className="absolute bottom-4 left-[5.75rem] top-4 w-px bg-[#ddd2ba] max-[620px]:left-[4.65rem]" />
        ) : null}
        {sections.map((section) => {
          if (section.kind === 'clueList') {
            return <WorldCharacterClueList key={section.variant} section={section} />;
          }
          const theme = milestoneTheme(section.milestone);
          const dotStyle: CSSProperties = {
            background: section.milestone.derived ? theme.accent : '#eef5ef',
            color: section.milestone.derived ? '#fffaf0' : '#1d5f43',
          };
          return (
            <article
              key={section.milestone.id}
              data-testid={section.milestone.derived ? 'world-character-career-derived-node' : 'world-character-biography-primary-node'}
              className="relative grid grid-cols-[88px_24px_minmax(0,1fr)] gap-3 py-3 max-[620px]:grid-cols-[70px_22px_minmax(0,1fr)]"
            >
              <div className="pt-3 text-right">
                {section.milestone.timeLabel ? (
                  <span className="block text-sm font-semibold tabular-nums text-[#1d5f43]">
                    {simplifyDisplayText(section.milestone.timeLabel)}
                  </span>
                ) : null}
              </div>
              <div className="relative z-10 flex justify-center pt-2">
                <span
                  data-testid="world-character-biography-marker"
                  style={dotStyle}
                  className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold shadow-[0_0_0_4px_#fbf8f1]"
                >
                  {biographicalTimelineMarker(section.milestone)}
                </span>
              </div>
              <div className="min-w-0">
                <WorldCharacterMilestoneCard milestone={section.milestone} />
                <WorldCharacterSecondaryClues clues={section.attachedClues} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type WorldCharacterQuestionTopicKind = 'relationship' | 'work' | 'role' | 'faction' | 'rank' | 'scene' | 'topic';

type WorldCharacterQuestionTopic = {
  kind: WorldCharacterQuestionTopicKind;
  text: string;
};

function cleanQuestionTopicText(value: string): string {
  return simplifyDisplayText(value).replace(/[。.!！?？]+$/u, '').trim();
}

function isReadableRelationshipQuestionTopic(value: string): boolean {
  const text = cleanQuestionTopicText(value);
  if (!text || text.length > 18) {
    return false;
  }
  if (/[XYＸＹ]/u.test(text) || /[A-Za-z]/u.test(text) || /[()（）:：]/u.test(text)) {
    return false;
  }
  return !/(所作|收到|得到|赠言|贺词|画赞|畫贊|图像|圖像|墓志|墓誌|墓表|神道碑|生祠|作序|由.+作|为.+作)/u.test(text);
}

function uniqueQuestionTopics(topics: WorldCharacterQuestionTopic[]): WorldCharacterQuestionTopic[] {
  const seen = new Set<string>();
  return topics
    .map((topic) => ({
      ...topic,
      text: cleanQuestionTopicText(topic.text),
    }))
    .filter((topic) => {
      if (!topic.text || seen.has(topic.text)) {
        return false;
      }
      seen.add(topic.text);
      return true;
    });
}

function worldCharacterQuestionText(
  topic: WorldCharacterQuestionTopic,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (topic.kind === 'relationship') {
    return t('SourceDetail.worldCharacter.relationshipQuestion', {
      topic: topic.text,
      defaultValue: `How are they connected to ${topic.text}?`,
    });
  }
  if (topic.kind === 'work') {
    return t('SourceDetail.worldCharacter.workQuestion', {
      topic: topic.text,
      defaultValue: `Why does ${topic.text} matter?`,
    });
  }
  if (topic.kind === 'role') {
    return t('SourceDetail.worldCharacter.roleQuestion', {
      topic: topic.text,
      defaultValue: `Why are they known as ${topic.text}?`,
    });
  }
  if (topic.kind === 'faction') {
    return t('SourceDetail.worldCharacter.factionQuestion', {
      topic: topic.text,
      defaultValue: `How did ${topic.text} shape their life?`,
    });
  }
  if (topic.kind === 'rank') {
    return t('SourceDetail.worldCharacter.rankQuestion', {
      topic: topic.text,
      defaultValue: `What did they experience while serving as ${topic.text}?`,
    });
  }
  if (topic.kind === 'scene') {
    return t('SourceDetail.worldCharacter.sceneQuestion', {
      topic: topic.text,
      defaultValue: `What did they experience in ${topic.text}?`,
    });
  }
  return t('SourceDetail.worldCharacter.topicQuestion', {
    topic: topic.text,
    defaultValue: `How would they explain ${topic.text}?`,
  });
}

function WorldCharacterConversationSection({
  source,
  onStartChat,
  disabled,
}: {
  source: SourceDetailData;
  onStartChat?: (initialComposerText?: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const relationshipTopics = source.relationshipClues
    .map((clue): WorldCharacterQuestionTopic | null => {
      const targetLabel = clue.targetLabel ? cleanQuestionTopicText(clue.targetLabel) : '';
      if (targetLabel && isReadableRelationshipQuestionTopic(targetLabel)) {
        return { kind: clue.type === 'status' ? 'role' : 'relationship', text: targetLabel };
      }
      const label = cleanQuestionTopicText(clue.label);
      if (!isReadableRelationshipQuestionTopic(label)) {
        return null;
      }
      return { kind: clue.type === 'status' ? 'role' : 'relationship', text: label };
    })
    .filter((topic): topic is WorldCharacterQuestionTopic => Boolean(topic));
  const questionTopics = uniqueQuestionTopics([
    source.worldCharacter?.role ? { kind: 'role' as const, text: source.worldCharacter.role } : null,
    source.worldCharacter?.faction ? { kind: 'faction' as const, text: source.worldCharacter.faction } : null,
    source.worldCharacter?.rank ? { kind: 'rank' as const, text: source.worldCharacter.rank } : null,
    ...(source.worldCharacter?.sceneRefs ?? []).map((sceneRef) => ({ kind: 'scene' as const, text: sceneRefLabel(sceneRef) })),
    ...source.works.map((work) => ({ kind: 'work' as const, text: work.title })),
    ...relationshipTopics,
    ...topicChips(source).map((topic) => ({ kind: 'topic' as const, text: topic })),
  ].filter((topic): topic is WorldCharacterQuestionTopic => Boolean(topic)));
  const questions = questionTopics
    .map((topic) => worldCharacterQuestionText(topic, t))
    .slice(0, 8);

  return (
    <section data-testid="world-character-ask-section" className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
      <h2 className="text-lg font-semibold text-[#262017]">
        {t('SourceDetail.worldCharacter.talkTitle', { defaultValue: 'You can ask them' })}
      </h2>
      {questions.length > 0 ? (
        <div data-testid="world-character-question-list" className="mt-3 grid gap-2">
          {questions.map((question) => (
            <button
              key={question}
              type="button"
              data-testid="world-character-question"
              onClick={() => onStartChat?.(question)}
              disabled={disabled || !onStartChat}
              className="rounded-[12px] bg-[#eef5ef] px-3 py-2 text-left text-xs font-semibold leading-5 text-[#1d5f43] transition hover:bg-[#e0eee6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5f43] disabled:cursor-default disabled:opacity-60"
            >
              {question}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-[#7a7060]">
          {t('SourceDetail.worldCharacter.noAnchors', { defaultValue: 'No suggested questions are available yet.' })}
        </p>
      )}
    </section>
  );
}

function WorldCharacterOpeningLine({
  source,
  className,
}: {
  source: SourceDetailData;
  className?: string;
}) {
  const { t } = useTranslation();
  const interaction = source.worldCharacter?.interaction;
  const openingLine = interaction?.greeting ? simplifyDisplayText(interaction.greeting) : null;
  if (!openingLine) {
    return null;
  }
  const hoverItems = [
    {
      label: t('SourceDetail.worldCharacter.tone', { defaultValue: 'Tone' }),
      value: interaction?.tone ? simplifyDisplayText(interaction.tone) : null,
    },
    {
      label: t('SourceDetail.worldCharacter.cadence', { defaultValue: 'Rhythm' }),
      value: interaction?.cadence ? simplifyDisplayText(interaction.cadence) : null,
    },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
  const hoverText = hoverItems.map((item) => `${item.label}: ${item.value}`).join(' · ');

  return (
    <div
      data-testid="world-character-opening-line"
      className={`flex items-start gap-2 ${className ?? ''}`}
    >
      {hoverItems.length > 0 ? (
        <TooltipProvider delayDuration={120}>
          <Tooltip
            placement="top"
            contentClassName="max-w-[260px] whitespace-normal px-3 py-2 text-left"
            content={(
              <div className="grid gap-2">
                {hoverItems.map((item) => (
                  <div key={item.label}>
                    <p className="text-[11px] font-semibold uppercase tracking-normal text-[var(--nimi-text-muted)]">{item.label}</p>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--nimi-text-primary)]">{item.value}</p>
                  </div>
                ))}
              </div>
            )}
          >
            <button
              type="button"
              data-testid="world-character-speech-profile-trigger"
              aria-label={hoverText}
              className="mt-[5px] inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border border-[#c9dccf] bg-[#fffdf8] text-[8px] font-semibold leading-none text-[#1d5f43] shadow-[0_1px_2px_rgba(34,26,18,.05)] transition hover:border-[#1d5f43] hover:bg-[#eef5ef] hover:text-[#0a7a4a]"
            >
              i
            </button>
          </Tooltip>
        </TooltipProvider>
      ) : null}
      <p className="min-w-0 text-sm leading-6 text-[#4a4336]">{openingLine}</p>
    </div>
  );
}

function WorldCharacterMediaSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const referenceImageUrl = source.referenceImageUrl;
  const voiceSample = source.voiceSample;
  const hasOpeningLine = Boolean(source.worldCharacter?.interaction?.greeting);

  if (!referenceImageUrl && !voiceSample && !hasOpeningLine) {
    return null;
  }

  return (
    <section data-testid="world-character-media-section" className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
      <h2 className="text-lg font-semibold text-[#262017]">
        {t('SourceDetail.worldCharacter.mediaTitle', { defaultValue: 'Look and voice' })}
      </h2>

      <div
        data-testid="world-character-media-frame"
        className="mx-auto mt-4 w-full max-w-[320px] overflow-hidden rounded-[14px] border border-[#e9e1d0] bg-[#fffdf8] p-2"
      >
        {referenceImageUrl ? (
          <div
            data-testid="world-character-reference-image"
            className="flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#fffdf8]"
          >
            <img
              src={referenceImageUrl}
              alt=""
              className="h-full w-full object-contain"
            />
          </div>
        ) : null}

        {hasOpeningLine ? (
          <WorldCharacterOpeningLine
            source={source}
            className={referenceImageUrl ? 'mt-3' : ''}
          />
        ) : null}

        {voiceSample ? (
          <audio
            data-testid="world-character-voice-sample-audio"
            className={(referenceImageUrl || hasOpeningLine) ? 'mt-3 w-full' : 'w-full'}
            controls
            preload="metadata"
            src={voiceSample.url}
          />
        ) : null}
      </div>
    </section>
  );
}

export function WorldCharacterSourceDetailPage(props: WorldCharacterSourceDetailPageProps) {
  const { t } = useTranslation();
  const { source } = props;
  const bannerImage = toSafeBackgroundImage(
    source.profileCoverUrl ?? source.worldBannerUrl ?? source.referenceImageUrl,
  );
  const primaryAction = describeCharacterPrimaryAction(source.sourceState);
  const canStartChat = primaryAction.action === 'open_partner';
  const dynastyLabel = worldCharacterHeroSubtitle(source);
  const heroDescription = worldCharacterHeroDescription(source, dynastyLabel);
  const statItems = props.stats
    ? [
        {
          key: 'friends',
          count: props.stats.friendsCount,
          label: t('SourceDetail.friends', { defaultValue: 'Friends' }),
        },
        {
          key: 'posts',
          count: props.stats.postsCount,
          label: t('SourceDetail.posts', { defaultValue: 'Posts' }),
        },
        {
          key: 'likes',
          count: props.stats.likesCount,
          label: t('SourceDetail.likes', { defaultValue: 'Likes' }),
        },
      ]
    : null;

  return (
    <div data-testid="world-character-source-detail-page" className="flex min-h-0 flex-1 flex-col">
      <ScrollArea
        className="flex-1"
        contentClassName="mx-auto max-w-[1180px] px-5 py-6"
      >
        <div className="grid gap-5">
          <section data-nimi-density="expressive" className="overflow-hidden rounded-[24px] border border-[#e8eae7] bg-white shadow-[0_10px_30px_rgba(30,41,38,.10)]">
            <div
              data-testid="world-character-hero-banner"
              className="relative h-[280px] max-[720px]:h-[190px]"
              style={{
                backgroundImage: bannerImage
                  ?? 'linear-gradient(105deg, #8ec9f2 0%, #f6e7a2 24%, #f6b8d4 46%, #b9a3f2 66%, #96d8bb 86%, #eef2ea 100%)',
                backgroundSize: 'cover',
                backgroundPosition: 'center 20%',
              }}
            >
              <button
                type="button"
                data-testid="world-character-back-button"
                onClick={props.onBack}
                aria-label={t('Common.back', { defaultValue: 'Back' })}
                className="absolute left-6 top-6 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--nimi-material-glass-thin-border)] bg-[var(--nimi-material-glass-thin-bg)] text-[#33423b] shadow-[0_10px_24px_rgba(30,41,38,.10)] nimi-material-glass-thin backdrop-blur-[var(--nimi-backdrop-blur-thin)] transition hover:bg-white/86 hover:text-[#1f6844]"
              >
                <ArrowLeft aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </button>
            </div>

            <div className="px-9 pb-7 max-[720px]:px-5">
              <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-7">
                <div className="min-w-0 max-w-[560px]">
                  <div
                    data-testid="world-character-hero-avatar"
                    className="relative -mt-[54px] h-[108px] w-[108px] overflow-hidden rounded-full bg-white"
                    style={{ boxShadow: '0 0 0 4px #ffffff, 0 10px 24px rgba(32,52,45,.16)' }}
                  >
                    <EntityAvatar
                      imageUrl={source.avatarUrl}
                      name={simplifyDisplayText(source.displayName)}
                      kind="human"
                      shape="circle"
                      sizeClassName="h-full w-full"
                      radiusClassName="rounded-full"
                      fallbackClassName="bg-[#e7f2ec] text-[#1d7a4f]"
                      textClassName="text-3xl font-semibold"
                    />
                  </div>
                  <div data-testid="world-character-hero-title-row" className="mt-4 flex flex-wrap items-center gap-4">
                    <h1 className="text-[44px] font-bold leading-[1.04] tracking-normal text-[#1b211d] max-[900px]:text-[38px] max-[620px]:text-[34px]">
                      {simplifyDisplayText(source.displayName)}
                    </h1>
                    {dynastyLabel ? (
                      <span
                        data-testid="world-character-hero-dynasty-badge"
                        className="shrink-0 rounded-[10px] border border-[#bad6c5] bg-[#f2faf4] px-3 py-1 text-[15px] font-semibold leading-5 text-[#2c8758]"
                      >
                        {simplifyDisplayText(dynastyLabel)}
                      </span>
                    ) : null}
                  </div>
                  {heroDescription ? (
                    <p data-testid="world-character-hero-description" className="mt-3 text-[16px] font-medium leading-6 text-[#4f5c55]">
                      {simplifyDisplayText(heroDescription)}
                    </p>
                  ) : null}
                </div>

                <div className="ml-auto mt-6 flex min-w-[360px] max-w-[430px] flex-col items-end gap-10 self-start max-[720px]:ml-0 max-[720px]:mt-0 max-[720px]:w-full max-[720px]:min-w-0 max-[720px]:max-w-none max-[720px]:items-start max-[720px]:gap-5">
                  {statItems ? (
                    <div
                      data-testid="world-character-hero-stats"
                      className="grid w-full grid-cols-3 gap-6 max-[720px]:gap-3"
                    >
                      {statItems.map(({ key, count, label }) => (
                        <div key={key} className="min-w-0 text-center">
                          <p className="text-[22px] font-bold leading-7 tabular-nums text-[#20342d]">{count}</p>
                          <p className="mt-1 text-sm font-medium leading-5 text-[#5b6763]">{label}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div data-testid="world-character-hero-actions" className="flex flex-wrap items-center justify-end gap-3 max-[720px]:justify-start">
                    {canStartChat ? (
                      <button
                        type="button"
                        onClick={() => props.onStartChat?.()}
                        disabled={!props.onStartChat}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#078a55] px-6 text-[15px] font-semibold text-white shadow-[0_10px_24px_rgba(7,138,85,.24)] transition hover:bg-[#067a4c] disabled:cursor-default disabled:opacity-60"
                      >
                        <MessageCircle aria-hidden className="h-[16px] w-[16px]" strokeWidth={2.2} />
                        {t('SourceDetail.worldCharacter.chatNow', { defaultValue: 'Chat now' })}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={props.onPrimaryAction}
                        disabled={primaryAction.disabled}
                        data-source-state={source.sourceState}
                        data-primary-action={primaryAction.action}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#d7dcd8] bg-white px-6 text-[15px] font-semibold text-[#1d5f43] shadow-[0_6px_16px_rgba(34,26,18,.06)] transition hover:border-[#1d5f43] disabled:cursor-default disabled:opacity-60"
                      >
                        <CirclePlus aria-hidden className="h-[16px] w-[16px]" strokeWidth={2.2} />
                        {worldCharacterPrimaryActionLabel(primaryAction, t)}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)_330px] gap-5 max-[980px]:grid-cols-1">
            <main className="grid min-w-0 gap-5">
              <section className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-[#262017]">{t('SourceDetail.worldCharacter.overviewTitle', { defaultValue: 'Character overview' })}</h2>
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
              <WorldCharacterConversationSection
                source={source}
                onStartChat={props.onStartChat}
                disabled={primaryAction.disabled}
              />
            </aside>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
