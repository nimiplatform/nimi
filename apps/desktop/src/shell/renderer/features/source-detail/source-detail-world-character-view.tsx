import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { describeRealmPersonaPrimaryAction } from '@renderer/features/explore/realm-persona-source-materialization';
import { Network, UserRound } from 'lucide-react';
import type {
  SourceDetailData,
  SourceDetailRelationshipClue,
  SourceDetailWorkCollection,
  SourceDetailWorldCharacterMilestone,
  SourceDetailWorldCharacterRelationshipNote,
} from './source-detail-model.js';
import { ScoreProgressBar, SourceDetailPrimaryActionIcon } from './source-detail-view-primitives.js';

type WorldCharacterSourceDetailPageProps = {
  source: SourceDetailData;
  stats?: { friendsCount: number; postsCount: number; likesCount: number } | null;
  worldScore?: number;
  onBack: () => void;
  onOpenWorld: () => void;
  onPrimaryAction: () => void;
  onSendGift: () => void;
};

type RelationshipMapItem = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  summary: string | null;
};

type RelationshipTheme = {
  accent: string;
  border: string;
  softBg: string;
  cardBg: string;
  ink: string;
  dash: string;
};

const RELATIONSHIP_GRAPH_CENTER = { x: 50, y: 50 };
const RELATIONSHIP_GRAPH_SLOTS: readonly { x: number; y: number }[] = [
  { x: 22, y: 23 },
  { x: 78, y: 24 },
  { x: 22, y: 75 },
  { x: 78, y: 74 },
  { x: 17, y: 50 },
  { x: 83, y: 50 },
  { x: 40, y: 15 },
  { x: 61, y: 85 },
];

const RELATIONSHIP_THEMES: Record<string, RelationshipTheme> = {
  kinship: {
    accent: '#2f8a57',
    border: '#9fcbaa',
    softBg: 'rgba(235,248,237,.94)',
    cardBg: 'linear-gradient(135deg, rgba(251,255,250,.98), rgba(235,248,237,.9))',
    ink: '#1f6844',
    dash: '3 3',
  },
  association: {
    accent: '#4f7ed8',
    border: '#9bb9ea',
    softBg: 'rgba(237,244,255,.94)',
    cardBg: 'linear-gradient(135deg, rgba(252,254,255,.98), rgba(238,245,255,.92))',
    ink: '#315fae',
    dash: '3 3',
  },
  status: {
    accent: '#68736f',
    border: '#b8c1bc',
    softBg: 'rgba(243,246,243,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,254,250,.98), rgba(241,244,240,.9))',
    ink: '#535d59',
    dash: '3 4',
  },
  postedToOffice: {
    accent: '#c08317',
    border: '#e1be74',
    softBg: 'rgba(255,247,228,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,253,247,.98), rgba(255,244,221,.92))',
    ink: '#98620f',
    dash: '3 3',
  },
  text: {
    accent: '#7d4ed3',
    border: '#ba9be6',
    softBg: 'rgba(247,240,255,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,252,255,.98), rgba(247,239,255,.92))',
    ink: '#6b3dbf',
    dash: '3 3',
  },
  entry: {
    accent: '#bd7c21',
    border: '#dfb772',
    softBg: 'rgba(255,247,232,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,253,248,.98), rgba(255,243,224,.92))',
    ink: '#9c6014',
    dash: '3 3',
  },
  biogAddress: {
    accent: '#278b87',
    border: '#8bc8c4',
    softBg: 'rgba(233,249,247,.94)',
    cardBg: 'linear-gradient(135deg, rgba(250,255,254,.98), rgba(234,248,246,.92))',
    ink: '#17706c',
    dash: '3 3',
  },
  postedAddress: {
    accent: '#278b87',
    border: '#8bc8c4',
    softBg: 'rgba(233,249,247,.94)',
    cardBg: 'linear-gradient(135deg, rgba(250,255,254,.98), rgba(234,248,246,.92))',
    ink: '#17706c',
    dash: '3 3',
  },
};

function sourceFactText(fact: Record<string, unknown>): string | null {
  const label = typeof fact.label === 'string'
    ? fact.label
    : typeof fact.title === 'string'
      ? fact.title
      : '';
  const key = typeof fact.key === 'string'
    ? fact.key
    : typeof fact.name === 'string'
      ? fact.name
      : '';
  const value = typeof fact.value === 'string'
    ? fact.value
    : typeof fact.summary === 'string'
      ? fact.summary
      : '';
  const hasReadableKey = /^[\p{Script=Han}\p{Letter}\s]{2,24}$/u.test(key);
  const text = [label || (hasReadableKey ? key : ''), value].filter(Boolean).join(': ').trim();
  return text || null;
}

function topicChips(source: SourceDetailData): string[] {
  return [
    source.worldCharacter?.role,
    source.worldCharacter?.faction,
    source.worldCharacter?.rank,
    ...source.tags,
    ...(source.entity?.tags ?? []),
    ...source.works.map((work) => work.title),
  ]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8);
}

function workStatusLabel(
  status: SourceDetailWorkCollection['status'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (status === 'resolved') {
    return t('SourceDetail.works.statusCollected', { defaultValue: 'Collected' });
  }
  if (status === 'unresolved') {
    return t('SourceDetail.works.statusPending', { defaultValue: 'To verify' });
  }
  return t('SourceDetail.works.statusUnknown', { defaultValue: 'Unknown' });
}

function worldCharacterPrimaryActionLabel(
  action: ReturnType<typeof describeRealmPersonaPrimaryAction>,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (action.disabled) {
    return t('SourceDetail.worldCharacter.primaryActionUnavailable', { defaultValue: 'Unavailable' });
  }
  return t('SourceDetail.worldCharacter.primaryActionMaterialize', { defaultValue: 'Add to my characters' });
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function relationKindLabel(
  type: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const labels: Record<string, string> = {
    status: t('SourceDetail.worldCharacter.relationshipKind.status', { defaultValue: 'Status' }),
    postedToOffice: t('SourceDetail.worldCharacter.relationshipKind.office', { defaultValue: 'Office' }),
    association: t('SourceDetail.worldCharacter.relationshipKind.association', { defaultValue: 'Association' }),
    text: t('SourceDetail.worldCharacter.relationshipKind.text', { defaultValue: 'Text' }),
    entry: t('SourceDetail.worldCharacter.relationshipKind.entry', { defaultValue: 'Entry' }),
    biogAddress: t('SourceDetail.worldCharacter.relationshipKind.place', { defaultValue: 'Place' }),
    postedAddress: t('SourceDetail.worldCharacter.relationshipKind.postedPlace', { defaultValue: 'Posted place' }),
  };
  return labels[type] ?? type;
}

function relationshipTheme(type: string): RelationshipTheme {
  return RELATIONSHIP_THEMES[type] ?? {
    accent: '#8c7742',
    border: '#cdbd8d',
    softBg: 'rgba(249,244,229,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,253,248,.98), rgba(249,244,229,.9))',
    ink: '#76602e',
    dash: '3 4',
  };
}

function milestoneKindLabel(
  milestone: SourceDetailWorldCharacterMilestone,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (milestone.kind === 'office') {
    return relationKindLabel('postedToOffice', t);
  }
  if (milestone.kind === 'work') {
    return relationKindLabel('text', t);
  }
  if (milestone.kind === 'entry') {
    return relationKindLabel('entry', t);
  }
  return t('SourceDetail.worldCharacter.milestoneKind.biography', { defaultValue: 'Biography' });
}

function milestoneTheme(milestone: SourceDetailWorldCharacterMilestone): RelationshipTheme {
  if (milestone.kind === 'office') {
    return relationshipTheme('postedToOffice');
  }
  if (milestone.kind === 'work') {
    return relationshipTheme('text');
  }
  if (milestone.kind === 'entry') {
    return relationshipTheme('entry');
  }
  return relationshipTheme('kinship');
}

function relationshipGraphPath(slot: { x: number; y: number }): string {
  const controlX = (RELATIONSHIP_GRAPH_CENTER.x + slot.x) / 2;
  return `M ${RELATIONSHIP_GRAPH_CENTER.x} ${RELATIONSHIP_GRAPH_CENTER.y} C ${controlX} ${RELATIONSHIP_GRAPH_CENTER.y} ${controlX} ${slot.y} ${slot.x} ${slot.y}`;
}

function relationshipGraphSlot(index: number): { x: number; y: number } {
  return RELATIONSHIP_GRAPH_SLOTS[index % RELATIONSHIP_GRAPH_SLOTS.length] ?? { x: 50, y: 18 };
}

function relationshipEdgeLabelPosition(slot: { x: number; y: number }): { left: string; top: string } {
  const left = RELATIONSHIP_GRAPH_CENTER.x + (slot.x - RELATIONSHIP_GRAPH_CENTER.x) * .54;
  const top = RELATIONSHIP_GRAPH_CENTER.y + (slot.y - RELATIONSHIP_GRAPH_CENTER.y) * .54;
  return {
    left: `${left}%`,
    top: `${top}%`,
  };
}

function buildRelationshipMapItems(
  notes: readonly SourceDetailWorldCharacterRelationshipNote[],
  clues: readonly SourceDetailRelationshipClue[],
  t: ReturnType<typeof useTranslation>['t'],
): RelationshipMapItem[] {
  const seen = new Set<string>();
  const items: RelationshipMapItem[] = [];
  const add = (item: RelationshipMapItem) => {
    const key = `${item.type}:${item.summary ?? item.title}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(item);
  };

  for (const clue of clues) {
    add({
      id: clue.id,
      type: clue.type,
      title: clue.label,
      subtitle: relationKindLabel(clue.type, t),
      summary: clue.summary,
    });
  }

  for (const note of notes) {
    add({
      id: note.id,
      type: note.type,
      title: relationKindLabel(note.type, t),
      subtitle: note.targetRef ?? relationKindLabel(note.type, t),
      summary: note.summary,
    });
  }

  return items.slice(0, 8);
}

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
      value: character.sceneRefs.length > 0 ? character.sceneRefs.join(' / ') : null,
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
            <p className="mt-1 text-sm font-semibold leading-6 text-[#262017]">{item.value}</p>
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
                  <h3 className="truncate text-base font-semibold text-[#262017]">{work.title}</h3>
                  {work.romanizedTitle ? (
                    <p className="mt-1 text-xs text-[#7a7060]">{work.romanizedTitle}</p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-[#f1eee6] px-2 py-0.5 text-[11px] font-medium text-[#7a7060]">
                  {workStatusLabel(work.status, t)}
                </span>
              </div>
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
                <span className="block text-sm font-semibold tabular-nums text-[#1d5f43]">
                  {milestone.timeLabel ?? t('SourceDetail.worldCharacter.timeUnknown', { defaultValue: 'Time unknown' })}
                </span>
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
                    <h3 className="text-sm font-semibold leading-6 text-[#262017]">{milestone.title}</h3>
                    <span style={badgeStyle} className="rounded-full px-2 py-0.5 text-[11px] font-semibold">
                      {milestoneKindLabel(milestone, t)}
                    </span>
                  </div>
                  {milestone.summary && milestone.summary !== milestone.title ? (
                    <p className="mt-1 text-sm leading-6 text-[#7a7060]">{milestone.summary}</p>
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

function WorldCharacterRelationshipCluesSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const notes = source.worldCharacter?.relationshipNotes ?? [];
  const clues = source.relationshipClues;
  const items = buildRelationshipMapItems(notes, clues, t);
  const relationTypes = uniqueStrings(items.map((item) => item.type));
  const [activeType, setActiveType] = useState('all');
  const filteredItems = activeType === 'all'
    ? items
    : items.filter((item) => item.type === activeType);
  const activeItems = filteredItems.length > 0 ? filteredItems : items;
  const focusLabels = uniqueStrings(activeItems.map((item) => relationKindLabel(item.type, t)));

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="world-character-relationship-clues-section"
      className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[#eef5ef] text-[#1d5f43]">
              <Network size={15} strokeWidth={2.2} />
            </span>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#1d5f43]">
              {t('SourceDetail.worldCharacter.relationshipEyebrow', { defaultValue: 'Graph evidence' })}
            </p>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-[#262017]">
            {t('SourceDetail.worldCharacter.relationshipTitle', { defaultValue: 'Relationship clues' })}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#7a7060]">
            {t('SourceDetail.worldCharacter.relationshipSummary', {
              name: source.displayName,
              kinds: focusLabels.join('、'),
              defaultValue: '{{name}} relationship network centers on {{kinds}}.',
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {relationTypes.map((type) => {
            const theme = relationshipTheme(type);
            return (
              <span key={type} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6f6556]">
                <span style={{ background: theme.accent }} className="h-2 w-2 rounded-full" />
                {relationKindLabel(type, t)}
              </span>
            );
          })}
        </div>
      </div>

      <div
        data-testid="world-character-relationship-map"
        className="relative mt-5 min-h-[330px] overflow-hidden rounded-[18px] border border-[#e9e1d0] bg-[#fffdf8] p-4"
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(238,245,239,.92) 0, rgba(255,253,248,.96) 42%, rgba(251,248,241,.98) 100%)',
        }}
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          {activeItems.map((item, index) => {
            const slot = relationshipGraphSlot(index);
            const theme = relationshipTheme(item.type);
            return (
              <path
                key={`${item.id}-edge`}
                d={relationshipGraphPath(slot)}
                fill="none"
                stroke={theme.accent}
                strokeDasharray={theme.dash}
                strokeLinecap="round"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {activeItems.map((item, index) => {
          const slot = relationshipGraphSlot(index);
          const theme = relationshipTheme(item.type);
          const labelPosition = relationshipEdgeLabelPosition(slot);
          return (
            <span
              key={`${item.id}-edge-label`}
              style={{
                ...labelPosition,
                color: theme.ink,
                borderColor: theme.border,
                background: theme.softBg,
              }}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
            >
              {relationKindLabel(item.type, t)}
            </span>
          );
        })}

        <div className="absolute left-1/2 top-1/2 z-20 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[6px] border-[#e4ebdf] bg-[#1f6844] px-3 text-center text-lg font-semibold leading-6 text-[#fffaf0] shadow-[0_12px_28px_rgba(31,104,68,.22)]">
          <span className="max-w-full break-words">{source.displayName}</span>
        </div>

        {activeItems.map((item, index) => {
          const slot = relationshipGraphSlot(index);
          const theme = relationshipTheme(item.type);
          const nodeStyle: CSSProperties = {
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            borderColor: theme.border,
            background: theme.softBg,
            color: theme.ink,
          };
          return (
            <article
              key={`${item.id}-node`}
              style={nodeStyle}
              className="absolute z-20 min-h-[64px] w-[168px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border px-4 py-3 shadow-sm max-[620px]:w-[138px] max-[620px]:px-3"
            >
              <div className="flex items-center gap-2">
                <span
                  style={{ background: theme.cardBg, color: theme.ink }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                >
                  <UserRound size={16} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold leading-5">{item.title}</h3>
                  <p className="truncate text-xs leading-4 opacity-75">{item.subtitle}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {['all', ...relationTypes].map((type) => {
          const active = activeType === type;
          const theme = type === 'all' ? relationshipTheme('kinship') : relationshipTheme(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveType(type)}
              style={{
                background: active ? theme.accent : '#fffdf8',
                borderColor: active ? theme.accent : '#e9e1d0',
                color: active ? '#fffaf0' : '#6f6556',
              }}
              className="rounded-full border px-4 py-1.5 text-xs font-semibold transition hover:border-[#1d5f43]"
            >
              {type === 'all'
                ? t('SourceDetail.worldCharacter.relationshipAll', { defaultValue: 'All' })
                : relationKindLabel(type, t)}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {activeItems.map((item) => {
          const theme = relationshipTheme(item.type);
          return (
            <article
              key={item.id}
              data-testid={`world-character-relationship-clue-${item.type}`}
              style={{ background: theme.cardBg, borderColor: theme.border }}
              className="rounded-[14px] border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    style={{ background: theme.softBg, color: theme.ink }}
                    className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  >
                    <UserRound size={15} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold leading-6 text-[#262017]">{item.title}</h3>
                    {item.summary ? (
                      <p className="mt-1 text-sm leading-6 text-[#7a7060]">{item.summary}</p>
                    ) : null}
                  </div>
                </div>
                <span
                  style={{ background: theme.softBg, color: theme.ink }}
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                >
                  {relationKindLabel(item.type, t)}
                </span>
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
  ]).slice(0, 8);

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
      value: interaction.greeting,
    },
    {
      label: t('SourceDetail.worldCharacter.tone', { defaultValue: 'Tone' }),
      value: interaction.tone,
    },
    {
      label: t('SourceDetail.worldCharacter.cadence', { defaultValue: 'Cadence' }),
      value: interaction.cadence,
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
  const facts = (source.entity?.facts ?? [])
    .map((fact) => sourceFactText(fact))
    .filter((fact): fact is string => Boolean(fact))
    .slice(0, 6);

  return (
    <div data-testid="world-character-source-detail-page" className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <ScrollArea
        className="flex-1 bg-gray-50"
        viewportClassName="bg-gray-50"
        contentClassName="mx-auto max-w-[1180px] px-5 py-6"
      >
        <div className="grid gap-5">
          <section className="relative overflow-hidden rounded-[24px] border border-[#e7dfce] bg-[#fbf8f1] shadow-[0_10px_28px_rgba(60,50,30,.08)]">
            <div
              className="absolute inset-0"
              style={{
                background: bannerUrl
                  ? `linear-gradient(90deg, rgba(22,34,26,.78), rgba(22,34,26,.18)), url(${bannerUrl}) center/cover no-repeat`
                  : 'linear-gradient(135deg, #1d5f43 0%, #738868 48%, #d6c8a8 100%)',
              }}
            />
            <div className="relative grid min-h-[310px] grid-cols-[minmax(0,1fr)_auto] gap-8 p-6 text-white max-[820px]:grid-cols-1">
              <div className="flex min-w-0 flex-col justify-between gap-7">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={props.onBack}
                    className="grid h-10 w-10 place-items-center rounded-full border border-white/35 bg-white/15 text-white transition hover:bg-white/24"
                    title={t('Common.back', { defaultValue: 'Back' })}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5" /><path d="m12 5-7 7 7 7" />
                    </svg>
                  </button>
                  <span className="rounded-full bg-white/16 px-3 py-1 text-xs font-semibold backdrop-blur">
                    {t('SourceDetail.worldCharacter.eyebrow', { defaultValue: 'World character detail' })}
                  </span>
                </div>

                <div className="max-w-2xl">
                  <div className="flex items-end gap-4 max-[620px]:items-start">
                    <EntityAvatar
                      imageUrl={source.avatarUrl}
                      name={source.displayName}
                      kind="source"
                      sizeClassName="h-24 w-24"
                      textClassName="text-2xl font-semibold"
                    />
                    <div className="min-w-0 pb-1">
                      <h1 className="truncate text-5xl font-semibold leading-tight tracking-normal max-[620px]:text-3xl">
                        {source.displayName}
                      </h1>
                      {source.handle ? (
                        <p className="mt-2 text-sm text-white/78">{source.handle}</p>
                      ) : null}
                    </div>
                  </div>
                  {source.bio ? (
                    <p className="mt-5 max-w-2xl text-base leading-8 text-white/88">{source.bio}</p>
                  ) : null}
                  {chips.length > 0 ? (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {chips.slice(0, 6).map((chip) => (
                        <span key={chip} className="rounded-full border border-white/22 bg-white/13 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="w-[250px] self-end rounded-[18px] border border-white/18 bg-white/16 p-4 backdrop-blur-md max-[820px]:w-full">
                <p className="text-xs font-semibold text-white/72">{t('SourceDetail.worldCharacter.primaryAction', { defaultValue: 'Next step' })}</p>
                <button
                  type="button"
                  onClick={props.onPrimaryAction}
                  disabled={primaryAction.disabled}
                  data-source-state={source.sourceState}
                  data-primary-action={primaryAction.action}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3 text-sm font-semibold text-[#1d5f43] shadow-sm disabled:cursor-default disabled:opacity-60"
                >
                  <SourceDetailPrimaryActionIcon action={primaryAction.action} />
                  {worldCharacterPrimaryActionLabel(primaryAction, t)}
                </button>
                {props.stats ? (
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-white/90">
                    <div className="rounded-[12px] bg-white/12 px-2 py-2">
                      <p className="text-lg font-semibold">{props.stats.friendsCount}</p>
                      <p className="text-[10px] text-white/66">{t('SourceDetail.friends', { defaultValue: 'Friends' })}</p>
                    </div>
                    <div className="rounded-[12px] bg-white/12 px-2 py-2">
                      <p className="text-lg font-semibold">{props.stats.postsCount}</p>
                      <p className="text-[10px] text-white/66">{t('SourceDetail.posts', { defaultValue: 'Posts' })}</p>
                    </div>
                    <div className="rounded-[12px] bg-white/12 px-2 py-2">
                      <p className="text-lg font-semibold">{props.stats.likesCount}</p>
                      <p className="text-[10px] text-white/66">{t('SourceDetail.likes', { defaultValue: 'Likes' })}</p>
                    </div>
                  </div>
                ) : null}
              </div>
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
                  <p className="mt-4 text-sm leading-7 text-[#4a4336]">{source.entity.summary}</p>
                ) : null}
                <WorldCharacterIdentityCoordinates source={source} />
              </section>

              <WorldCharacterMilestonesSection source={source} />
              <WorldCharacterWorksSection source={source} />
              <WorldCharacterRelationshipCluesSection source={source} />

              {facts.length > 0 ? (
                <section className="rounded-[18px] border border-[#e7dfce] bg-[#fbf8f1] p-5 shadow-[0_8px_22px_rgba(60,50,30,.06)]">
                  <h2 className="text-xl font-semibold text-[#262017]">{t('SourceDetail.worldCharacter.factsTitle', { defaultValue: 'Additional notes' })}</h2>
                  <div className="mt-4 grid gap-3">
                    {facts.map((fact) => (
                      <div key={fact} className="rounded-[14px] border border-[#e9e1d0] bg-[#fffdf8] p-4 text-sm leading-6 text-[#4a4336]">
                        {fact}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
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
