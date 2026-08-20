import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Network, UserRound } from 'lucide-react';
import type {
  SourceDetailData,
  SourceDetailRelationshipClue,
} from './source-detail-model.js';
import type { CharacterProfileRelationshipProjection } from '../realm-source/character-source-profile-projection.js';
import { simplifySourceDetailChineseText as simplifyDisplayText } from './source-detail-simplified-chinese.js';
import { uniqueStrings } from './source-detail-world-character-labels.js';
import { allRelationshipsTheme, relationKindLabel, relationshipTheme } from './source-detail-world-character-theme.js';

type RelationshipMapItem = {
  id: string;
  type: string;
  graphTitle: string;
  evidenceText: string;
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
  notes: readonly CharacterProfileRelationshipProjection[],
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
  const notes = source.characterProfile.relationshipNotes;
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
      className="rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-elevation-base)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[var(--nimi-action-primary-bg)]">
              <Network size={15} strokeWidth={2.2} />
            </span>
            <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
              {t('SourceDetail.worldCharacter.relationshipTitle', { defaultValue: 'Relationship clues' })}
            </h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-[var(--nimi-text-muted)]">
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
              <span key={type} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--nimi-text-muted)]">
                <span style={{ background: theme.accent }} className="h-2 w-2 rounded-full" />
                {relationKindLabel(type, t)}
              </span>
            );
          })}
        </div>
      </div>

      <div
        data-testid="world-character-relationship-map"
        className="relative mt-5 min-h-[330px] overflow-hidden rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4"
        style={{
          background: 'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent) 0, var(--nimi-surface-panel) 42%, var(--nimi-surface-panel) 100%)',
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

        <div className="absolute left-1/2 top-1/2 z-20 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[6px] border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_26%,transparent)] bg-[var(--nimi-action-primary-bg)] px-3 text-center text-lg font-semibold leading-6 text-[var(--nimi-text-inverse)] shadow-[var(--nimi-elevation-raised)]">
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
          const theme = type === 'all' ? allRelationshipsTheme() : relationshipTheme(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveType(type)}
              style={{
                background: active ? theme.accent : 'var(--nimi-surface-panel)',
                borderColor: active ? theme.accent : 'var(--nimi-border-subtle)',
                color: active
                  ? (type === 'all' ? 'var(--nimi-action-primary-text)' : 'var(--nimi-text-inverse)')
                  : 'var(--nimi-text-muted)',
              }}
              className="rounded-full border px-4 py-1.5 text-xs font-semibold transition hover:border-[var(--nimi-action-primary-bg)]"
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
                    <h3 className="text-sm font-semibold leading-6 text-[var(--nimi-text-primary)]">{item.evidenceText}</h3>
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
