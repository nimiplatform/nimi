import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldRelationshipEvidenceCharacterBucket, WorldRelationshipEvidenceKind } from './world-detail-relationship-model.js';
import type { WorldCharacter } from './world-detail-types.js';
import { PAPER, PAPER_RADIUS } from './world-detail-paper-model.js';

export type PeopleFilterKey = 'all' | 'featured' | 'literati' | 'academy' | 'open';
export type RelationFilterKey = 'all' | WorldRelationshipEvidenceKind;

export type GraphPosition = {
  readonly x: number;
  readonly y: number;
};

type GraphCardBounds = {
  readonly halfWidth: number;
  readonly halfHeight: number;
};

type GraphRect = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
};

export type CenterClue = {
  readonly id: string;
  readonly kind: WorldRelationshipEvidenceKind;
  readonly text: string;
  readonly edgeId: string | null;
  readonly clueId: string | null;
};

export type RelationshipKindTheme = {
  readonly accent: string;
  readonly border: string;
  readonly softBg: string;
  readonly cardBg: string;
  readonly ink: string;
  readonly dash: string;
};

export const FILTER_KEYS: readonly PeopleFilterKey[] = ['all', 'featured', 'literati', 'academy', 'open'];
export const GRAPH_MIN_ZOOM = .72;
export const GRAPH_MAX_ZOOM = 1.36;
export const GRAPH_DEFAULT_ZOOM = 1.1;

export const GRAPH_CENTER: GraphPosition = { x: 500, y: 500 };
export const EDGE_LABEL_SIZE = { width: 108, height: 28 };
const GRAPH_LABEL_SAFE_GAP = 6;
const GRAPH_LABEL_ESCAPE_STEP = 12;
const GRAPH_LABEL_ESCAPE_MAX = 240;
const GRAPH_VIEWBOX_BOUNDS: GraphRect = { left: 0, right: 1000, top: 0, bottom: 1000 };
const CENTER_GRAPH_CARD_BOUNDS: GraphCardBounds = { halfWidth: 88, halfHeight: 88 };
const TARGET_GRAPH_CARD_BOUNDS: GraphCardBounds = { halfWidth: 96, halfHeight: 48 };

const KIND_THEMES: Record<WorldRelationshipEvidenceKind, RelationshipKindTheme> = {
  kinship: {
    accent: '#2c8a54',
    border: '#98caa5',
    softBg: 'rgba(232,247,235,.92)',
    cardBg: 'linear-gradient(135deg, rgba(246,253,247,.98), rgba(235,248,238,.92))',
    ink: '#17603c',
    dash: '5 6',
  },
  association: {
    accent: '#4d7edb',
    border: '#93b5ee',
    softBg: 'rgba(235,243,255,.92)',
    cardBg: 'linear-gradient(135deg, rgba(248,251,255,.98), rgba(236,244,255,.92))',
    ink: '#2f62c0',
    dash: '4 6',
  },
  office: {
    accent: '#c28419',
    border: '#e2bf73',
    softBg: 'rgba(255,247,228,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,252,243,.98), rgba(255,244,221,.92))',
    ink: '#9b650f',
    dash: '4 6',
  },
  text: {
    accent: '#7c4ed1',
    border: '#b99ae6',
    softBg: 'rgba(246,239,255,.94)',
    cardBg: 'linear-gradient(135deg, rgba(253,250,255,.98), rgba(246,238,255,.92))',
    ink: '#6b39bf',
    dash: '4 6',
  },
  entry: {
    accent: '#bd7b21',
    border: '#dfb46f',
    softBg: 'rgba(255,246,231,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,252,246,.98), rgba(255,242,221,.92))',
    ink: '#9c5f14',
    dash: '4 6',
  },
  address: {
    accent: '#278b87',
    border: '#8bc8c4',
    softBg: 'rgba(232,249,247,.94)',
    cardBg: 'linear-gradient(135deg, rgba(248,255,254,.98), rgba(232,248,246,.92))',
    ink: '#17706c',
    dash: '4 6',
  },
  status: {
    accent: '#68736f',
    border: '#b7c0bb',
    softBg: 'rgba(243,246,243,.94)',
    cardBg: 'linear-gradient(135deg, rgba(253,253,250,.98), rgba(240,244,240,.92))',
    ink: '#515c58',
    dash: '3 6',
  },
  topic: {
    accent: '#8c7742',
    border: '#cdbd8d',
    softBg: 'rgba(249,244,229,.94)',
    cardBg: 'linear-gradient(135deg, rgba(255,253,247,.98), rgba(247,239,218,.92))',
    ink: '#76602e',
    dash: '3 6',
  },
};

export const KIND_ORDER: readonly WorldRelationshipEvidenceKind[] = [
  'association',
  'kinship',
  'office',
  'text',
  'entry',
  'address',
  'status',
  'topic',
];

export const RELATION_FILTER_KEYS: readonly RelationFilterKey[] = ['all', ...KIND_ORDER];

export function panelStyle(): CSSProperties {
  return {
    background: PAPER.card,
    border: `1px solid ${PAPER.border}`,
    borderRadius: PAPER_RADIUS.lg,
    boxShadow: PAPER.cardShadow,
  };
}

export function softPanelStyle(): CSSProperties {
  return {
    background: PAPER.cardSoft,
    border: `1px solid ${PAPER.borderSoft}`,
    borderRadius: PAPER_RADIUS.md,
  };
}

export function toolButtonStyle(active = false): CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 999,
    border: `1px solid ${active ? PAPER.green : PAPER.border}`,
    background: active ? PAPER.green : 'rgba(255,252,244,.86)',
    color: active ? '#f6f2e7' : PAPER.muted,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

export function filterChipStyle(active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? PAPER.green : PAPER.border}`,
    background: active ? PAPER.green : PAPER.card,
    color: active ? '#f6f2e7' : PAPER.muted,
    borderRadius: 999,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11.5,
    fontWeight: 800,
    padding: '5px 10px',
    whiteSpace: 'nowrap',
  };
}

export function relationshipKindTheme(kind: WorldRelationshipEvidenceKind): RelationshipKindTheme {
  return KIND_THEMES[kind];
}

export function storyFilterChipStyle(active: boolean, kind: RelationFilterKey): CSSProperties {
  const theme = kind === 'all' ? null : relationshipKindTheme(kind);
  const accent = theme?.accent ?? PAPER.green;
  return {
    border: `1px solid ${active ? accent : PAPER.borderSoft}`,
    background: active ? accent : 'rgba(255,253,248,.9)',
    color: active ? '#fffaf0' : PAPER.muted,
    borderRadius: 999,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 850,
    padding: '7px 16px',
    whiteSpace: 'nowrap',
    boxShadow: active ? '0 7px 16px rgba(64,55,36,.11)' : 'none',
  };
}

export function relationKindLabel(t: ReturnType<typeof useTranslation>['t'], kind: WorldRelationshipEvidenceKind): string {
  return t(`WorldDetail.paper.relationshipExplorer.kinds.${kind}`);
}

export function relationFilterLabel(t: ReturnType<typeof useTranslation>['t'], key: RelationFilterKey): string {
  return key === 'all'
    ? t('WorldDetail.paper.relationshipExplorer.allKinds')
    : t(`WorldDetail.paper.relationshipExplorer.kinds.${key}`);
}

export function clampZoom(value: number): number {
  return Math.min(GRAPH_MAX_ZOOM, Math.max(GRAPH_MIN_ZOOM, Number(value.toFixed(2))));
}

export function graphPosition(index: number): GraphPosition {
  const slots: readonly GraphPosition[] = [
    { x: 255, y: 244 },
    { x: 746, y: 250 },
    { x: 245, y: 688 },
    { x: 760, y: 676 },
    { x: 163, y: 474 },
    { x: 843, y: 488 },
    { x: 356, y: 156 },
    { x: 636, y: 800 },
  ];
  const slot = slots[index % slots.length] ?? GRAPH_CENTER;
  const lap = Math.floor(index / slots.length);
  if (lap === 0) {
    return slot;
  }
  return {
    x: slot.x + (index % 2 === 0 ? -18 : 18),
    y: slot.y + (lap * 24),
  };
}

export function graphPath(position: GraphPosition): string {
  const controlX = (GRAPH_CENTER.x + position.x) / 2;
  return `M ${GRAPH_CENTER.x} ${GRAPH_CENTER.y} C ${controlX} ${GRAPH_CENTER.y} ${controlX} ${position.y} ${position.x} ${position.y}`;
}

function graphClearanceDistance(unitX: number, unitY: number, bounds: GraphCardBounds): number {
  const labelHalfWidth = EDGE_LABEL_SIZE.width / 2;
  const labelHalfHeight = EDGE_LABEL_SIZE.height / 2;
  const xDistance = Math.abs(unitX) < .01
    ? Number.POSITIVE_INFINITY
    : (bounds.halfWidth + labelHalfWidth + GRAPH_LABEL_SAFE_GAP) / Math.abs(unitX);
  const yDistance = Math.abs(unitY) < .01
    ? Number.POSITIVE_INFINITY
    : (bounds.halfHeight + labelHalfHeight + GRAPH_LABEL_SAFE_GAP) / Math.abs(unitY);
  return Math.min(xDistance, yDistance);
}

function graphRectFromCenter(position: GraphPosition, bounds: GraphCardBounds, padding = 0): GraphRect {
  return {
    left: position.x - bounds.halfWidth - padding,
    right: position.x + bounds.halfWidth + padding,
    top: position.y - bounds.halfHeight - padding,
    bottom: position.y + bounds.halfHeight + padding,
  };
}

function graphLabelRect(position: GraphPosition): GraphRect {
  return graphRectFromCenter(position, {
    halfWidth: EDGE_LABEL_SIZE.width / 2,
    halfHeight: EDGE_LABEL_SIZE.height / 2,
  });
}

function graphRectsOverlap(a: GraphRect, b: GraphRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function graphRectWithin(a: GraphRect, b: GraphRect): boolean {
  return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
}

function graphLabelOverlapsOccupied(position: GraphPosition, targetPosition: GraphPosition): boolean {
  const labelRect = graphLabelRect(position);
  const centerRect = graphRectFromCenter(GRAPH_CENTER, CENTER_GRAPH_CARD_BOUNDS, GRAPH_LABEL_SAFE_GAP);
  const targetRect = graphRectFromCenter(targetPosition, TARGET_GRAPH_CARD_BOUNDS, GRAPH_LABEL_SAFE_GAP);
  return graphRectsOverlap(labelRect, centerRect) || graphRectsOverlap(labelRect, targetRect);
}

function graphEscapedLabelPosition(
  basePosition: GraphPosition,
  targetPosition: GraphPosition,
  unitX: number,
  unitY: number,
): GraphPosition {
  if (!graphLabelOverlapsOccupied(basePosition, targetPosition)) {
    return basePosition;
  }

  const tangentX = -unitY;
  const tangentY = unitX;
  for (let offset = GRAPH_LABEL_ESCAPE_STEP; offset <= GRAPH_LABEL_ESCAPE_MAX; offset += GRAPH_LABEL_ESCAPE_STEP) {
    const candidates: readonly GraphPosition[] = [
      { x: basePosition.x + tangentX * offset, y: basePosition.y + tangentY * offset },
      { x: basePosition.x - tangentX * offset, y: basePosition.y - tangentY * offset },
    ];
    const resolved = candidates.find((candidate) => (
      graphRectWithin(graphLabelRect(candidate), GRAPH_VIEWBOX_BOUNDS)
      && !graphLabelOverlapsOccupied(candidate, targetPosition)
    ));
    if (resolved) {
      return resolved;
    }
  }

  return basePosition;
}

export function relationshipGraphEdgeLabelPosition(position: GraphPosition): GraphPosition {
  const dx = position.x - GRAPH_CENTER.x;
  const dy = position.y - GRAPH_CENTER.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) {
    return GRAPH_CENTER;
  }
  const unitX = dx / distance;
  const unitY = dy / distance;
  const minDistance = graphClearanceDistance(unitX, unitY, CENTER_GRAPH_CARD_BOUNDS);
  const maxDistance = distance - graphClearanceDistance(unitX, unitY, TARGET_GRAPH_CARD_BOUNDS);
  const labelDistance = maxDistance >= minDistance
    ? minDistance
    : distance / 2;
  const basePosition = {
    x: GRAPH_CENTER.x + unitX * labelDistance,
    y: GRAPH_CENTER.y + unitY * labelDistance,
  };
  return graphEscapedLabelPosition(basePosition, position, unitX, unitY);
}

export function extractWorkTitles(texts: readonly string[]): string[] {
  const titles = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/《([^》]+)》/g)) {
      const title = match[1]?.trim();
      if (title) {
        titles.add(`《${title}》`);
      }
    }
  }
  return [...titles];
}

export function identityTags(character: WorldCharacter, t: ReturnType<typeof useTranslation>['t']): string[] {
  const importance = character.importance === 'PRIMARY'
    ? t('WorldDetail.paper.relationshipExplorer.identity.primary')
    : character.importance === 'SECONDARY'
      ? t('WorldDetail.paper.relationshipExplorer.identity.secondary')
      : t('WorldDetail.paper.relationshipExplorer.identity.background');
  return [
    character.role,
    character.faction,
    character.rank,
    character.location,
    importance,
  ].filter((value): value is string => Boolean(value?.trim())).slice(0, 4);
}

function isAcademyOrScholar(character: WorldCharacter): boolean {
  const text = [
    character.role,
    character.faction,
    character.rank,
    character.location,
    character.bio,
    ...(character.tags ?? []),
  ].filter(Boolean).join(' ');
  return ['书院', '学术', '理学', '学者', '教育', '山长', '儒', '师'].some((token) => text.includes(token));
}

export function clueCount(bucket: WorldRelationshipEvidenceCharacterBucket): number {
  return bucket.linkedEvidenceCount + bucket.unlinkedEvidenceCount;
}

export function bucketMatchesFilter(bucket: WorldRelationshipEvidenceCharacterBucket, key: PeopleFilterKey): boolean {
  switch (key) {
    case 'all':
      return true;
    case 'featured':
      return bucket.character.importance === 'PRIMARY' || bucket.linkedEvidenceCount > 0;
    case 'literati':
      return bucket.primaryKind === 'association'
        || bucket.primaryKind === 'text'
        || String(bucket.character.role ?? '').includes('文');
    case 'academy':
      return isAcademyOrScholar(bucket.character);
    case 'open':
      return bucket.status !== 'linked';
    default:
      return true;
  }
}

export function bucketMatchesQuery(bucket: WorldRelationshipEvidenceCharacterBucket, query: string): boolean {
  if (!query) {
    return true;
  }
  const character = bucket.character;
  const haystack = [
    character.name,
    character.role,
    character.faction,
    character.rank,
    character.location,
    ...(character.tags ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function relatedLists(center: WorldCharacter, characters: readonly WorldCharacter[]) {
  const others = characters.filter((character) => character.id !== center.id);
  const works = extractWorkTitles(center.tags ?? []);
  return {
    contemporaries: others.slice(0, 4),
    sameIdentity: others.filter((character) => (
      Boolean(center.role && character.role === center.role)
      || Boolean(center.faction && character.faction === center.faction)
      || Boolean(center.rank && character.rank === center.rank)
    )).slice(0, 4),
    sameWorks: works.length > 0
      ? others.filter((character) => extractWorkTitles(character.tags ?? []).some((work) => works.includes(work))).slice(0, 4)
      : [],
  };
}

export function dedupeCenterClues(clues: readonly CenterClue[]): CenterClue[] {
  const seenTexts = new Set<string>();
  return clues.filter((clue) => {
    const key = clue.text.replace(/\s+/g, ' ').trim();
    if (!key) {
      return false;
    }
    if (seenTexts.has(key)) {
      return false;
    }
    seenTexts.add(key);
    return true;
  });
}
