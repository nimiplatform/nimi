import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Network, UserRound } from 'lucide-react';
import { describeRealmPersonaPrimaryAction } from '@renderer/features/explore/realm-persona-source-materialization';
import type {
  SourceDetailData,
  SourceDetailRelationshipClue,
  SourceDetailWorkCollection,
  SourceDetailWorldCharacterMilestone,
  SourceDetailWorldCharacterRelationshipNote,
} from './source-detail-model.js';
import { simplifySourceDetailChineseText as simplifyDisplayText } from './source-detail-simplified-chinese.js';

type RelationshipMapItem = {
  id: string;
  type: string;
  graphTitle: string;
  evidenceText: string;
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

const SCENE_REF_LABELS: Record<string, string> = {
  'yuan-literati-network': '元代文人网络',
  'yuan-academy-gathering': '元代书院雅集',
  'yuan-official-court': '元代朝廷官场',
  'ming-literati-network': '明代文人网络',
  'ming-official-career': '明代仕宦履历',
  'ming-kinship-clan': '明代宗族亲缘',
};

const SCENE_DYNASTY_LABELS: Record<string, string> = {
  qin: '秦代',
  han: '汉代',
  sui: '隋代',
  tang: '唐代',
  song: '宋代',
  liao: '辽代',
  jin: '金代',
  yuan: '元代',
  ming: '明代',
  qing: '清代',
};

const SCENE_KIND_LABELS: Record<string, string> = {
  'literati-network': '文人网络',
  'academy-gathering': '书院雅集',
  'official-court': '朝廷官场',
  'official-career': '仕宦履历',
  'kinship-clan': '宗族亲缘',
};

export function sceneRefLabel(sceneRef: string): string {
  const normalized = simplifyDisplayText(sceneRef.trim());
  const direct = SCENE_REF_LABELS[normalized];
  if (direct) {
    return direct;
  }
  const [dynastyKey, ...kindParts] = normalized.split('-').filter(Boolean);
  const dynastyLabel = dynastyKey ? SCENE_DYNASTY_LABELS[dynastyKey] : null;
  const kindLabel = SCENE_KIND_LABELS[kindParts.join('-')];
  if (dynastyLabel && kindLabel) {
    return `${dynastyLabel}${kindLabel}`;
  }
  return normalized;
}

function normalizeDynastyText(value: string): string | null {
  const normalized = simplifyDisplayText(value.trim());
  if (!normalized) {
    return null;
  }
  const exactLabels = ['秦代', '汉代', '隋代', '唐代', '宋代', '辽代', '金代', '元代', '明代', '清代'];
  for (const label of exactLabels) {
    if (normalized.includes(label)) {
      return label;
    }
  }
  const dynastyAliases: readonly [RegExp, string][] = [
    [/(?:秦朝|qin(?:[-_\s]?dynasty)?)/iu, '秦代'],
    [/(?:汉朝|漢朝|han(?:[-_\s]?dynasty)?)/iu, '汉代'],
    [/(?:隋朝|sui(?:[-_\s]?dynasty)?)/iu, '隋代'],
    [/(?:唐朝|tang(?:[-_\s]?dynasty)?)/iu, '唐代'],
    [/(?:宋朝|song(?:[-_\s]?dynasty)?)/iu, '宋代'],
    [/(?:辽朝|遼朝|liao(?:[-_\s]?dynasty)?)/iu, '辽代'],
    [/(?:金朝|jin(?:[-_\s]?dynasty)?)/iu, '金代'],
    [/(?:元朝|yuan(?:[-_\s]?dynasty)?)/iu, '元代'],
    [/(?:明朝|ming(?:[-_\s]?dynasty)?)/iu, '明代'],
    [/(?:清朝|qing(?:[-_\s]?dynasty)?)/iu, '清代'],
  ];
  for (const [pattern, label] of dynastyAliases) {
    if (pattern.test(normalized)) {
      return label;
    }
  }
  return null;
}

function sceneDynastyLabel(sceneRef: string): string | null {
  const normalized = simplifyDisplayText(sceneRef.trim());
  const direct = SCENE_REF_LABELS[normalized];
  const directDynasty = direct ? normalizeDynastyText(direct) : null;
  if (directDynasty) {
    return directDynasty;
  }
  const [dynastyKey] = normalized.split('-').filter(Boolean);
  if (dynastyKey && SCENE_DYNASTY_LABELS[dynastyKey]) {
    return SCENE_DYNASTY_LABELS[dynastyKey];
  }
  return normalizeDynastyText(normalized);
}

export function worldCharacterHeroSubtitle(source: SourceDetailData): string | null {
  const sceneDynasties = uniqueStrings(
    (source.worldCharacter?.sceneRefs ?? []).map(sceneDynastyLabel),
  );
  if (sceneDynasties.length > 0) {
    return sceneDynasties.slice(0, 2).join(' / ');
  }

  const textCandidates = [
    source.worldCharacter?.faction,
    source.worldCharacter?.role,
    source.worldCharacter?.rank,
    source.worldId,
    source.entity?.summary,
    source.bio,
    ...(source.entity?.tags ?? []),
    ...source.tags,
  ];
  for (const candidate of textCandidates) {
    const label = normalizeDynastyText(String(candidate || ''));
    if (label) {
      return label;
    }
  }
  return null;
}

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
    ...source.works.map((work) => work.title),
  ]
    .filter((value): value is string => Boolean(value))
    .map(simplifyDisplayText)
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
  if (action.action === 'become_partner') {
    return t('SourceDetail.worldCharacter.primaryActionMaterialize', {
      defaultValue: action.label,
    });
  }
  return action.label;
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

function RelationshipTargetIcon({
  type,
  size,
  strokeWidth,
}: {
  readonly type: string;
  readonly size: number;
  readonly strokeWidth: number;
}) {
  const Icon = type === 'postedAddress' ? MapPin : UserRound;
  return <Icon size={size} strokeWidth={strokeWidth} />;
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
  sourceName: string,
  notes: readonly SourceDetailWorldCharacterRelationshipNote[],
  clues: readonly SourceDetailRelationshipClue[],
  t: ReturnType<typeof useTranslation>['t'],
): RelationshipMapItem[] {
  const seen = new Set<string>();
  const items: RelationshipMapItem[] = [];
  const add = (item: RelationshipMapItem) => {
    const key = `${item.type}:${item.graphTitle}:${item.evidenceText}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(item);
  };

  for (const clue of clues) {
    const graphTitle = relationshipGraphTitleFromClue(sourceName, clue.targetLabel, clue.summary ?? clue.label, clue.label);
    const evidenceText = clue.detail ?? relationshipEvidenceTextFromClue(graphTitle, clue.label, clue.summary);
    add({
      id: clue.id,
      type: clue.type,
      graphTitle: simplifyDisplayText(graphTitle),
      evidenceText: simplifyDisplayText(evidenceText),
    });
  }

  for (const note of notes) {
    add({
      id: note.id,
      type: note.type,
      graphTitle: simplifyDisplayText(note.targetRef ?? relationKindLabel(note.type, t)),
      evidenceText: simplifyDisplayText(note.summary),
    });
  }

  return items.slice(0, 8);
}

function relationshipGraphTitleFromClue(
  sourceName: string,
  targetLabel: string | null,
  evidenceText: string,
  fallbackLabel: string,
): string {
  const explicitTarget = normalizeRelationshipGraphName(targetLabel);
  if (explicitTarget) {
    return explicitTarget;
  }
  return extractRelatedPersonName(sourceName, evidenceText)
    ?? extractRelatedPersonName(sourceName, fallbackLabel)
    ?? fallbackLabel;
}

function relationshipEvidenceTextFromClue(
  graphTitle: string,
  label: string,
  summary: string | null,
): string {
  const normalizedLabel = label.trim();
  const normalizedSummary = summary?.trim() || null;
  const labelWithResolvedTarget = normalizedLabel.replaceAll('Y', graphTitle);

  if (isSpecificRelationshipLabel(normalizedLabel, graphTitle)) {
    return labelWithResolvedTarget;
  }
  return normalizedSummary ?? labelWithResolvedTarget;
}

function isSpecificRelationshipLabel(label: string, graphTitle: string): boolean {
  if (!label || label === graphTitle) {
    return false;
  }
  if (label.includes('Y')) {
    return true;
  }
  return [
    '墓志铭',
    '墓誌銘',
    '墓表',
    '神道碑',
    '答書',
    '答书',
    '贈',
    '赠',
    '書',
    '书',
    '所作',
    '所著',
    '所撰',
    '收到',
    '由',
  ].some((token) => label.includes(token));
}

function normalizeRelationshipGraphName(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  if (!normalized || /^[A-Za-z]$/u.test(normalized) || normalized.includes('Y')) {
    return null;
  }
  return normalized;
}

function extractRelatedPersonName(sourceName: string, text: string): string | null {
  const normalizedSource = sourceName.trim();
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  const escapedSource = normalizedSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pairedPatterns = [
    new RegExp(`^([^，。；、\\s]+)与${escapedSource}存在`, 'u'),
    new RegExp(`^${escapedSource}与([^，。；、\\s]+)存在`, 'u'),
  ];
  for (const pattern of pairedPatterns) {
    const match = normalizedText.match(pattern);
    const candidate = normalizeRelationshipGraphName(match?.[1]);
    if (candidate) {
      return candidate;
    }
  }

  const eventPatterns = [
    /由([\p{Script=Han}·・]{2,12})所/u,
    /收到([\p{Script=Han}·・]{2,12})的/u,
    /從([\p{Script=Han}·・]{2,12})處收到/u,
    /从([\p{Script=Han}·・]{2,12})处收到/u,
    /為([\p{Script=Han}·・]{2,12})所/u,
    /为([\p{Script=Han}·・]{2,12})所/u,
  ];
  for (const pattern of eventPatterns) {
    const match = normalizedText.match(pattern);
    const candidate = normalizeRelationshipGraphName(match?.[1]);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export function WorldCharacterRelationshipCluesSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const notes = source.worldCharacter?.relationshipNotes ?? [];
  const clues = source.relationshipClues;
  const items = buildRelationshipMapItems(source.displayName, notes, clues, t);
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
              name: simplifyDisplayText(source.displayName),
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
          <span className="max-w-full break-words">{simplifyDisplayText(source.displayName)}</span>
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
                  <RelationshipTargetIcon type={item.type} size={16} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold leading-5">{item.graphTitle}</h3>
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
                    <RelationshipTargetIcon type={item.type} size={15} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold leading-6 text-[#262017]">{item.evidenceText}</h3>
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
