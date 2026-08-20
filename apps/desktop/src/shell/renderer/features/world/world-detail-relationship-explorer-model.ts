import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldRelationshipEvidenceCharacterBucket, WorldRelationshipEvidenceKind } from './world-detail-relationship-model.js';
import type { WorldCharacter } from './world-detail-types.js';

export type PeopleFilterKey = 'all' | 'literati' | 'academy';
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

export const FILTER_KEYS: readonly PeopleFilterKey[] = ['all', 'literati', 'academy'];
export const EXPLORER_PANEL_HEIGHT_PX = 1100;
export const EXPLORER_GRAPH_CANVAS_MIN_HEIGHT_PX = 360;
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

const STATUS_THEME_TOKENS = {
  success: {
    accent: 'var(--nimi-status-success)',
    border: 'var(--nimi-status-success-soft-border)',
    softBg: 'var(--nimi-status-success-soft-bg)',
    ink: 'var(--nimi-status-success-soft-text)',
  },
  info: {
    accent: 'var(--nimi-status-info)',
    border: 'var(--nimi-status-info-soft-border)',
    softBg: 'var(--nimi-status-info-soft-bg)',
    ink: 'var(--nimi-status-info-soft-text)',
  },
  neutral: {
    accent: 'var(--nimi-status-neutral)',
    border: 'var(--nimi-status-neutral-soft-border)',
    softBg: 'var(--nimi-status-neutral-soft-bg)',
    ink: 'var(--nimi-status-neutral-soft-text)',
  },
  warning: {
    accent: 'var(--nimi-status-warning)',
    border: 'var(--nimi-status-warning-soft-border)',
    softBg: 'var(--nimi-status-warning-soft-bg)',
    ink: 'var(--nimi-status-warning-soft-text)',
  },
  danger: {
    accent: 'var(--nimi-status-danger)',
    border: 'var(--nimi-status-danger-soft-border)',
    softBg: 'var(--nimi-status-danger-soft-bg)',
    ink: 'var(--nimi-status-danger-soft-text)',
  },
  indigo: {
    accent: 'var(--nimi-color-indigo)',
    border: 'color-mix(in srgb, var(--nimi-color-indigo) 26%, transparent)',
    softBg: 'color-mix(in srgb, var(--nimi-color-indigo) 14%, transparent)',
    ink: 'var(--nimi-color-indigo)',
  },
  primary: {
    accent: 'var(--nimi-action-primary-bg)',
    border: 'color-mix(in srgb, var(--nimi-action-primary-bg) 26%, transparent)',
    softBg: 'color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent)',
    ink: 'var(--nimi-action-primary-bg)',
  },
} as const;

type StatusThemeTokenSet = (typeof STATUS_THEME_TOKENS)[keyof typeof STATUS_THEME_TOKENS];

function kindThemeFrom(tokens: StatusThemeTokenSet, dash: string): RelationshipKindTheme {
  return {
    ...tokens,
    cardBg: `linear-gradient(135deg, var(--nimi-surface-card), ${tokens.softBg})`,
    dash,
  };
}

const KIND_THEMES: Record<WorldRelationshipEvidenceKind, RelationshipKindTheme> = {
  kinship: kindThemeFrom(STATUS_THEME_TOKENS.success, '5 6'),
  association: kindThemeFrom(STATUS_THEME_TOKENS.info, '4 6'),
  office: kindThemeFrom(STATUS_THEME_TOKENS.warning, '4 6'),
  text: kindThemeFrom(STATUS_THEME_TOKENS.indigo, '4 6'),
  entry: kindThemeFrom(STATUS_THEME_TOKENS.danger, '4 6'),
  address: kindThemeFrom(STATUS_THEME_TOKENS.primary, '4 6'),
  status: kindThemeFrom(STATUS_THEME_TOKENS.neutral, '3 6'),
  topic: kindThemeFrom(STATUS_THEME_TOKENS.neutral, '3 6'),
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
    background: 'var(--nimi-surface-card)',
    border: '1px solid var(--nimi-border-subtle)',
    borderRadius: 'var(--nimi-radius-lg)',
    boxShadow: 'var(--nimi-elevation-base)',
  };
}

export function softPanelStyle(): CSSProperties {
  return {
    background: 'var(--nimi-surface-panel)',
    border: '1px solid var(--nimi-border-subtle)',
    borderRadius: 'var(--nimi-radius-md)',
  };
}

export function toolButtonStyle(active = false): CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 999,
    border: `1px solid ${active ? 'var(--nimi-action-primary-bg)' : 'var(--nimi-border-subtle)'}`,
    background: active ? 'var(--nimi-action-primary-bg)' : 'var(--nimi-surface-card)',
    color: active ? 'var(--nimi-action-primary-text)' : 'var(--nimi-text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

export function filterChipStyle(active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? 'var(--nimi-action-primary-bg)' : 'var(--nimi-border-subtle)'}`,
    background: active ? 'var(--nimi-action-primary-bg)' : 'var(--nimi-surface-card)',
    color: active ? 'var(--nimi-action-primary-text)' : 'var(--nimi-text-muted)',
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
  const accent = theme?.accent ?? 'var(--nimi-action-primary-bg)';
  return {
    border: `1px solid ${active ? accent : 'var(--nimi-border-subtle)'}`,
    background: active ? accent : 'var(--nimi-surface-card)',
    color: active ? 'var(--nimi-text-inverse)' : 'var(--nimi-text-muted)',
    borderRadius: 999,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 850,
    padding: '7px 16px',
    whiteSpace: 'nowrap',
    boxShadow: active ? 'var(--nimi-elevation-base)' : 'none',
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

const DISPLAY_EVIDENCE_KIND_PREFIX = /^(?:kinship|association|office|text|entry|address|status|topic)\s*[:：]\s*/i;

export function displayRelationshipEvidenceText(value: string): string {
  return value.replace(DISPLAY_EVIDENCE_KIND_PREFIX, '').replace(/\s+/g, ' ').trim();
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
    case 'literati':
      return bucket.primaryKind === 'association'
        || bucket.primaryKind === 'text'
        || String(bucket.character.role ?? '').includes('文');
    case 'academy':
      return isAcademyOrScholar(bucket.character);
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
