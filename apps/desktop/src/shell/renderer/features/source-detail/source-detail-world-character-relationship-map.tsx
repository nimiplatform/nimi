import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, MapPin, Network, UserRound } from 'lucide-react';
import type { SourceDetailData } from './source-detail-model.js';
import { uniqueStrings } from './source-detail-world-character-labels.js';
import { isAddressRelationshipType } from './source-detail-world-character-relationships.js';
import { allRelationshipsTheme, relationKindLabel, relationshipTheme } from './source-detail-world-character-theme.js';

// One relationship as authored. `type` is the explicit relationship type or
// null; an untyped item renders neutrally (no kind label, neutral theme and
// icon) instead of being dropped or classified from its text.
type RelationshipMapItem = {
  id: string;
  type: string | null;
  title: string;
  summary: string | null;
  details: string[];
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
  readonly type: string | null;
  readonly size: number;
  readonly strokeWidth: number;
}) {
  const Icon = isAddressRelationshipType(type)
    ? MapPin
    : type === 'kinship' || type === 'association'
      ? UserRound
      : Link2;
  return <Icon size={size} strokeWidth={strokeWidth} />;
}

function relationshipGraphPath(end: { x: number; y: number }): string {
  const controlX = (RELATIONSHIP_GRAPH_CENTER.x + end.x) / 2;
  return `M ${RELATIONSHIP_GRAPH_CENTER.x} ${RELATIONSHIP_GRAPH_CENTER.y} C ${controlX} ${RELATIONSHIP_GRAPH_CENTER.y} ${controlX} ${end.y} ${end.x} ${end.y}`;
}

function relationshipGraphSlot(index: number): { x: number; y: number } {
  return RELATIONSHIP_GRAPH_SLOTS[index % RELATIONSHIP_GRAPH_SLOTS.length] ?? { x: 50, y: 18 };
}

type RelationshipGraphSize = { width: number; height: number };

const RELATIONSHIP_NODE_WIDTH_PX = 168;
const RELATIONSHIP_NODE_COMPACT_WIDTH_PX = 138;
const RELATIONSHIP_NODE_COMPACT_CONTAINER_PX = 620;
const RELATIONSHIP_NODE_HALF_HEIGHT_PX = 33;

function relationshipGraphEdgeEnd(
  slot: { x: number; y: number },
  size: RelationshipGraphSize | null,
): { x: number; y: number } {
  if (!size || size.width <= 0 || size.height <= 0) {
    return slot;
  }
  const halfWidth = (size.width <= RELATIONSHIP_NODE_COMPACT_CONTAINER_PX
    ? RELATIONSHIP_NODE_COMPACT_WIDTH_PX
    : RELATIONSHIP_NODE_WIDTH_PX) / 2;
  const centerX = (RELATIONSHIP_GRAPH_CENTER.x / 100) * size.width;
  const centerY = (RELATIONSHIP_GRAPH_CENTER.y / 100) * size.height;
  const slotX = (slot.x / 100) * size.width;
  const slotY = (slot.y / 100) * size.height;
  const deltaX = slotX - centerX;
  const deltaY = slotY - centerY;
  // Ray-vs-box slab test: the ray enters the node pill at the LATER of the
  // per-axis entry points, so take the max. A negative ratio means the center
  // is already inside that axis slab and must not constrain the endpoint.
  let scale = 0;
  if (deltaX !== 0) {
    scale = Math.max(scale, (slotX - Math.sign(deltaX) * halfWidth - centerX) / deltaX);
  }
  if (deltaY !== 0) {
    scale = Math.max(scale, (slotY - Math.sign(deltaY) * RELATIONSHIP_NODE_HALF_HEIGHT_PX - centerY) / deltaY);
  }
  const clamped = Math.min(scale, 1);
  return {
    x: RELATIONSHIP_GRAPH_CENTER.x + (slot.x - RELATIONSHIP_GRAPH_CENTER.x) * clamped,
    y: RELATIONSHIP_GRAPH_CENTER.y + (slot.y - RELATIONSHIP_GRAPH_CENTER.y) * clamped,
  };
}

function relationshipEdgeLabelPosition(slot: { x: number; y: number }): { left: string; top: string } {
  const left = RELATIONSHIP_GRAPH_CENTER.x + (slot.x - RELATIONSHIP_GRAPH_CENTER.x) * .54;
  const top = RELATIONSHIP_GRAPH_CENTER.y + (slot.y - RELATIONSHIP_GRAPH_CENTER.y) * .54;
  return {
    left: `${left}%`,
    top: `${top}%`,
  };
}

function explicitRelationshipType(value: string | null | undefined): string | null {
  const type = value?.trim();
  return type || null;
}

// Builds map items from explicit relationship fields only. The node title is
// the explicit target label, then the explicit relation label, then the
// localized explicit type, then the summary. Names are never extracted from
// prose, and a value that equals a known source or entity id is treated as an
// identifier, not display text.
function buildRelationshipMapItems(
  source: SourceDetailData,
  t: ReturnType<typeof useTranslation>['t'],
): RelationshipMapItem[] {
  const sourceIds = [source.id, source.sourceId, source.worldId, source.entity?.id, source.runtimeSourceRef];
  const displayText = (value: string | null | undefined, ids: readonly (string | null | undefined)[]): string | null => {
    const text = value?.trim();
    if (!text || [...sourceIds, ...ids].some((id) => id && id.trim() === text)) {
      return null;
    }
    return text;
  };
  const seen = new Set<string>();
  const items: RelationshipMapItem[] = [];
  const add = (item: RelationshipMapItem) => {
    const key = [item.type ?? '', item.title, item.summary ?? ''].join('\u0000');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(item);
  };

  for (const clue of source.relationshipClues) {
    const ids = [clue.id, clue.targetEntityId];
    const label = displayText(clue.label, ids);
    const summary = displayText(clue.summary, ids);
    const title = displayText(clue.targetLabel, ids)
      ?? label
      ?? (clue.type ? relationKindLabel(clue.type, t) : null)
      ?? summary;
    if (!title) {
      continue;
    }
    add({
      id: clue.id,
      type: clue.type,
      title,
      summary: summary && summary !== title ? summary : null,
      details: uniqueStrings([label, ...clue.details]).filter((detail) => detail !== title && detail !== summary),
    });
  }

  for (const note of source.characterProfile.relationshipNotes) {
    const type = explicitRelationshipType(note.type);
    const ids = [note.id, note.targetRef];
    const summary = displayText(note.summary, ids);
    const targetLabel = note.targetRef && Object.hasOwn(source.relationshipTargetLabels, note.targetRef)
      ? source.relationshipTargetLabels[note.targetRef]
      : null;
    const title = displayText(targetLabel, ids)
      ?? (type ? relationKindLabel(type, t) : null)
      ?? summary;
    if (!title) {
      continue;
    }
    add({
      id: note.id,
      type,
      title,
      summary: summary && summary !== title ? summary : null,
      details: [],
    });
  }

  return items.slice(0, 8);
}

export function WorldCharacterRelationshipCluesSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const items = buildRelationshipMapItems(source, t);
  const relationTypes = uniqueStrings(items.map((item) => item.type));
  const [activeType, setActiveType] = useState('all');
  const [graphSize, setGraphSize] = useState<RelationshipGraphSize | null>(null);
  const graphRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = graphRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      setGraphSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const filteredItems = activeType === 'all'
    ? items
    : items.filter((item) => item.type === activeType);
  const activeItems = filteredItems.length > 0 ? filteredItems : items;
  const focusLabels = uniqueStrings(activeItems.map((item) => (item.type ? relationKindLabel(item.type, t) : null)));

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
          {focusLabels.length > 0 ? (
            <p className="mt-1 text-sm leading-6 text-[var(--nimi-text-muted)]">
              {t('SourceDetail.worldCharacter.relationshipSummary', {
                name: source.displayName,
                kinds: focusLabels.join('、'),
                defaultValue: '{{name}} relationship network centers on {{kinds}}.',
              })}
            </p>
          ) : null}
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
        ref={graphRef}
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
                d={relationshipGraphPath(relationshipGraphEdgeEnd(slot, graphSize))}
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
          if (!item.type) {
            return null;
          }
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
                background: `color-mix(in srgb, ${theme.accent} 10%, var(--nimi-surface-card))`,
              }}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
            >
              {relationKindLabel(item.type, t)}
            </span>
          );
        })}

        <div className="absolute left-1/2 top-1/2 z-20 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[6px] border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_26%,transparent)] bg-[var(--nimi-action-primary-bg)] px-3 text-center text-lg font-semibold leading-6 text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-raised)]">
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
                  <RelationshipTargetIcon type={item.type} size={16} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold leading-5">{item.title}</h3>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {relationTypes.length > 0 ? (
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
      ) : null}

      <div data-testid="world-character-relationship-cards" className="mt-4 grid gap-3 md:grid-cols-2">
        {activeItems.map((item) => {
          const theme = relationshipTheme(item.type);
          return (
            <article
              key={item.id}
              data-testid={`world-character-relationship-clue-${item.type ?? 'untyped'}`}
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
                    <h3 className="text-sm font-semibold leading-6 text-[var(--nimi-text-primary)]">{item.title}</h3>
                    {item.details.length > 0 ? (
                      <p className="text-xs font-semibold leading-5 text-[var(--nimi-text-secondary)]">{item.details.join(' · ')}</p>
                    ) : null}
                    {item.summary ? (
                      <p className="mt-1 text-sm leading-6 text-[var(--nimi-text-muted)]">{item.summary}</p>
                    ) : null}
                  </div>
                </div>
                {item.type ? (
                  <span
                    style={{ background: theme.softBg, color: theme.ink }}
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  >
                    {relationKindLabel(item.type, t)}
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
