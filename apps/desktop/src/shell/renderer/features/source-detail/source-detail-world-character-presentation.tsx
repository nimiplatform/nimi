import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, UserRound } from 'lucide-react';
import { describeRealmPersonaPrimaryAction } from '@renderer/features/explore/realm-persona-source-materialization';
import type {
  SourceDetailData,
  SourceDetailRelationshipClue,
  SourceDetailWorkCollection,
  SourceDetailWorldCharacterMilestone,
  SourceDetailWorldCharacterRelationshipNote,
} from './source-detail-model.js';

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

export function sourceFactText(fact: Record<string, unknown>): string | null {
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

export function topicChips(source: SourceDetailData): string[] {
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

export function workStatusLabel(
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

export function worldCharacterPrimaryActionLabel(
  action: ReturnType<typeof describeRealmPersonaPrimaryAction>,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (action.disabled) {
    return t('SourceDetail.worldCharacter.primaryActionUnavailable', { defaultValue: 'Unavailable' });
  }
  return t('SourceDetail.worldCharacter.primaryActionMaterialize', { defaultValue: 'Add to my characters' });
}

export function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
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

export function milestoneKindLabel(
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

export function milestoneTheme(milestone: SourceDetailWorldCharacterMilestone): RelationshipTheme {
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

export function WorldCharacterRelationshipCluesSection({ source }: { source: SourceDetailData }) {
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
