import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties, ReactNode } from 'react';
import {
  BookOpen,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import {
  buildWorldRelationshipEvidenceGraph,
  type WorldRelationshipEvidenceCharacterBucket,
  type WorldRelationshipEvidenceEdge,
  type WorldRelationshipEvidenceKind,
  type WorldRelationshipEvidenceRecord,
} from './world-detail-relationship-model.js';
import type { WorldCharacter, WorldDetailData, WorldHistoryBundle } from './world-detail-types.js';
import { PAPER, PAPER_RADIUS, PAPER_SERIF, formatNum } from './world-detail-paper-model.js';
import {
  IconArrow,
  IconChevron,
  PaperAvatar,
  PaperTag,
  paperGhostButton,
  paperPrimaryButton,
} from './world-detail-paper-primitives.js';
import { characterMeta } from './world-detail-template-model.js';

type WorldRelationshipExplorerProps = {
  readonly world: WorldDetailData;
  readonly characters: readonly WorldCharacter[];
  readonly history: WorldHistoryBundle;
  readonly onBack: () => void;
  readonly onSelectCharacter?: (characterId: string) => void;
};

type PeopleFilterKey = 'all' | 'featured' | 'literati' | 'academy' | 'open';
type RelationFilterKey = 'all' | WorldRelationshipEvidenceKind;

type GraphPosition = {
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

type CenterClue = {
  readonly id: string;
  readonly kind: WorldRelationshipEvidenceKind;
  readonly text: string;
  readonly edgeId: string | null;
  readonly clueId: string | null;
};

type RelationshipKindTheme = {
  readonly accent: string;
  readonly border: string;
  readonly softBg: string;
  readonly cardBg: string;
  readonly ink: string;
  readonly dash: string;
};

const FILTER_KEYS: readonly PeopleFilterKey[] = ['all', 'featured', 'literati', 'academy', 'open'];
const GRAPH_MIN_ZOOM = .72;
const GRAPH_MAX_ZOOM = 1.36;
const GRAPH_DEFAULT_ZOOM = 1.1;

const GRAPH_CENTER: GraphPosition = { x: 500, y: 500 };
const EDGE_LABEL_SIZE = { width: 108, height: 28 };
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

const KIND_ORDER: readonly WorldRelationshipEvidenceKind[] = [
  'association',
  'kinship',
  'office',
  'text',
  'entry',
  'address',
  'status',
  'topic',
];

const RELATION_FILTER_KEYS: readonly RelationFilterKey[] = ['all', ...KIND_ORDER];

function panelStyle(): CSSProperties {
  return {
    background: PAPER.card,
    border: `1px solid ${PAPER.border}`,
    borderRadius: PAPER_RADIUS.lg,
    boxShadow: PAPER.cardShadow,
  };
}

function softPanelStyle(): CSSProperties {
  return {
    background: PAPER.cardSoft,
    border: `1px solid ${PAPER.borderSoft}`,
    borderRadius: PAPER_RADIUS.md,
  };
}

function toolButtonStyle(active = false): CSSProperties {
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

function filterChipStyle(active: boolean): CSSProperties {
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

function relationshipKindTheme(kind: WorldRelationshipEvidenceKind): RelationshipKindTheme {
  return KIND_THEMES[kind];
}

function storyFilterChipStyle(active: boolean, kind: RelationFilterKey): CSSProperties {
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

function relationKindLabel(t: ReturnType<typeof useTranslation>['t'], kind: WorldRelationshipEvidenceKind): string {
  return t(`WorldDetail.paper.relationshipExplorer.kinds.${kind}`);
}

function relationFilterLabel(t: ReturnType<typeof useTranslation>['t'], key: RelationFilterKey): string {
  return key === 'all'
    ? t('WorldDetail.paper.relationshipExplorer.allKinds')
    : t(`WorldDetail.paper.relationshipExplorer.kinds.${key}`);
}

function clampZoom(value: number): number {
  return Math.min(GRAPH_MAX_ZOOM, Math.max(GRAPH_MIN_ZOOM, Number(value.toFixed(2))));
}

function graphPosition(index: number): GraphPosition {
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

function graphPath(position: GraphPosition): string {
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

function extractWorkTitles(texts: readonly string[]): string[] {
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

function identityTags(character: WorldCharacter, t: ReturnType<typeof useTranslation>['t']): string[] {
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

function clueCount(bucket: WorldRelationshipEvidenceCharacterBucket): number {
  return bucket.linkedEvidenceCount + bucket.unlinkedEvidenceCount;
}

function bucketMatchesFilter(bucket: WorldRelationshipEvidenceCharacterBucket, key: PeopleFilterKey): boolean {
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

function bucketMatchesQuery(bucket: WorldRelationshipEvidenceCharacterBucket, query: string): boolean {
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

function relatedLists(center: WorldCharacter, characters: readonly WorldCharacter[]) {
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

function dedupeCenterClues(clues: readonly CenterClue[]): CenterClue[] {
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

function CharacterMiniList({
  title,
  characters,
  onSelect,
}: {
  readonly title: string;
  readonly characters: readonly WorldCharacter[];
  readonly onSelect: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 900, color: PAPER.inkStrong }}>{title}</div>
      {characters.length > 0 ? (
        <div style={{ display: 'grid', gap: 7 }}>
          {characters.map((character) => (
            <button key={character.id} type="button" onClick={() => onSelect(character.id)} style={{ ...softPanelStyle(), padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
              <PaperAvatar name={character.name} imageUrl={character.avatarUrl} size={30} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 900, color: PAPER.inkStrong }}>{character.name}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: PAPER.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(character)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : <div style={{ fontSize: 12, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.profile.noRelated')}</div>}
    </div>
  );
}

function ProfileFallback({
  center,
  characters,
  onSelect,
  onOpenProfile,
}: {
  readonly center: WorldCharacter;
  readonly characters: readonly WorldCharacter[];
  readonly onSelect: (characterId: string) => void;
  readonly onOpenProfile?: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  const tags = identityTags(center, t);
  const works = extractWorkTitles(center.tags ?? []);
  const related = relatedLists(center, characters);
  const materials = [
    center.bio ? t('WorldDetail.paper.relationshipExplorer.profile.bioMaterial') : null,
    center.tags?.length ? t('WorldDetail.paper.relationshipExplorer.profile.topicMaterial', { count: center.tags.length }) : null,
    center.location ? t('WorldDetail.paper.relationshipExplorer.profile.placeMaterial', { place: center.location }) : null,
    works.length ? t('WorldDetail.paper.relationshipExplorer.profile.workMaterial', { count: works.length }) : null,
  ].filter((item): item is string => Boolean(item));
  const directions = [
    center.faction ? t('WorldDetail.paper.relationshipExplorer.profile.directionFaction', { value: center.faction }) : null,
    center.role ? t('WorldDetail.paper.relationshipExplorer.profile.directionRole', { value: center.role }) : null,
    works[0] ? t('WorldDetail.paper.relationshipExplorer.profile.directionWork', { value: works[0] }) : null,
    center.location ? t('WorldDetail.paper.relationshipExplorer.profile.directionPlace', { value: center.location }) : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div style={{ ...panelStyle(), padding: 22, minHeight: 452 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
        <PaperAvatar name={center.name} imageUrl={center.avatarUrl} size={64} />
        <div style={{ minWidth: 0 }}>
          <PaperTag>{t('WorldDetail.paper.relationshipExplorer.profile.status')}</PaperTag>
          <h3 style={{ margin: '10px 0 6px', fontFamily: PAPER_SERIF, fontSize: 24, fontWeight: 900, color: PAPER.inkStrong }}>{center.name}</h3>
          <p style={{ margin: 0, maxWidth: 680, fontSize: 13.5, lineHeight: 1.75, color: PAPER.muted }}>{center.bio || t('WorldDetail.paper.relationshipExplorer.profile.defaultIntro')}</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)', gap: 14 }}>
        <div style={{ ...softPanelStyle(), padding: 15 }}>
          <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.profile.identity')}</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            {tags.map((tag) => <PaperTag key={tag} tone="neutral">{tag}</PaperTag>)}
          </div>
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.profile.materials')}</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: PAPER.muted, fontSize: 12.5, lineHeight: 1.7 }}>
            {(materials.length > 0 ? materials : [t('WorldDetail.paper.relationshipExplorer.profile.basicMaterial')]).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div style={{ ...softPanelStyle(), padding: 15 }}>
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.profile.directions')}</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: PAPER.muted, fontSize: 12.5, lineHeight: 1.7 }}>
            {(directions.length > 0 ? directions : [t('WorldDetail.paper.relationshipExplorer.profile.defaultDirection')]).map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <button type="button" onClick={() => onOpenProfile?.(center.id)} style={paperPrimaryButton}>
              {t('WorldDetail.paper.relationshipExplorer.profile.viewProfile')} <IconArrow size={13} />
            </button>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12, marginTop: 14 }}>
        <CharacterMiniList title={t('WorldDetail.paper.relationshipExplorer.profile.contemporaries')} characters={related.contemporaries} onSelect={onSelect} />
        <CharacterMiniList title={t('WorldDetail.paper.relationshipExplorer.profile.sameIdentity')} characters={related.sameIdentity} onSelect={onSelect} />
        <CharacterMiniList title={t('WorldDetail.paper.relationshipExplorer.profile.sameWorks')} characters={related.sameWorks} onSelect={onSelect} />
      </div>
    </div>
  );
}

function RelationshipNetwork({
  center,
  edges,
  allEdgeCount,
  relationKindFilter,
  relationKindOptions,
  zoomScale,
  detailCollapsed,
  selectedEdgeId,
  onSelectEdge,
  onSelectCharacter,
  onRelationKindFilterChange,
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleDetailPanel,
}: {
  readonly center: WorldCharacter;
  readonly edges: readonly WorldRelationshipEvidenceEdge[];
  readonly allEdgeCount: number;
  readonly relationKindFilter: RelationFilterKey;
  readonly relationKindOptions: readonly RelationFilterKey[];
  readonly zoomScale: number;
  readonly detailCollapsed: boolean;
  readonly selectedEdgeId: string | null;
  readonly onSelectEdge: (edgeId: string) => void;
  readonly onSelectCharacter: (characterId: string) => void;
  readonly onRelationKindFilterChange: (filter: RelationFilterKey) => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetView: () => void;
  readonly onToggleDetailPanel: () => void;
}) {
  const { t } = useTranslation();
  const displayedEdges = edges.slice(0, 8);
  const legendKinds = relationKindOptions.filter((kind): kind is WorldRelationshipEvidenceKind => kind !== 'all').slice(0, 6);
  const detailToggleLabel = t(
    `WorldDetail.paper.relationshipExplorer.controls.${detailCollapsed ? 'expandDetail' : 'collapseDetail'}`,
  );
  return (
    <section
      data-testid="world-relationship-story-panel"
      style={{
        ...panelStyle(),
        minHeight: 720,
        padding: 22,
        overflow: 'hidden',
        background:
          'radial-gradient(55% 42% at 52% 8%, rgba(65,111,79,.10), transparent 60%),'
          + 'linear-gradient(135deg, rgba(255,253,247,.96), rgba(249,247,240,.93) 48%, rgba(251,249,243,.96))',
      }}
    >
      <div data-testid="world-relationship-graph-toolbar" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: PAPER.greenSoftBg, color: PAPER.green, flexShrink: 0 }}>
            <BookOpen size={16} strokeWidth={2.2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.25, fontWeight: 950, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.story.title')}</h2>
            <p style={{ margin: '8px 0 0', maxWidth: 620, fontSize: 12.8, lineHeight: 1.65, color: PAPER.muted }}>
              {t('WorldDetail.paper.relationshipExplorer.story.subtitle', { name: center.name })}
            </p>
          </div>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: 10, flexShrink: 0 }}>
          <div data-testid="world-relationship-kind-legend" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {legendKinds.map((kind) => {
              const theme = relationshipKindTheme(kind);
              return (
                <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: PAPER.muted, fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: theme.accent, boxShadow: `0 0 0 3px ${theme.softBg}` }} />
                  {relationKindLabel(t, kind)}
                </span>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" aria-label={t('WorldDetail.paper.relationshipExplorer.controls.zoomOut')} title={t('WorldDetail.paper.relationshipExplorer.controls.zoomOut')} onClick={onZoomOut} style={toolButtonStyle()}>
              <Minus size={14} />
            </button>
            <button type="button" aria-label={t('WorldDetail.paper.relationshipExplorer.controls.zoomIn')} title={t('WorldDetail.paper.relationshipExplorer.controls.zoomIn')} onClick={onZoomIn} style={toolButtonStyle()}>
              <Plus size={14} />
            </button>
            <button type="button" aria-label={t('WorldDetail.paper.relationshipExplorer.controls.resetView')} title={t('WorldDetail.paper.relationshipExplorer.controls.resetView')} onClick={onResetView} style={toolButtonStyle()}>
              <RotateCcw size={14} />
            </button>
            <button type="button" aria-label={detailToggleLabel} title={detailToggleLabel} onClick={onToggleDetailPanel} style={toolButtonStyle(detailCollapsed)}>
              {detailCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
            </button>
          </div>
        </div>
      </div>
      <div style={{ aspectRatio: '1 / 1', border: `1px solid ${PAPER.borderSoft}`, borderRadius: 22, overflow: 'hidden', background: 'linear-gradient(180deg, rgba(255,253,248,.74), rgba(250,247,238,.62))' }}>
        <svg
          viewBox="0 0 1000 1000"
          role="img"
          aria-label={t('WorldDetail.paper.relationshipExplorer.graphLabel')}
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          <g transform={`translate(${GRAPH_CENTER.x} ${GRAPH_CENTER.y}) scale(${zoomScale}) translate(${-GRAPH_CENTER.x} ${-GRAPH_CENTER.y})`}>
            <circle cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} r="138" fill="none" stroke="rgba(34,93,62,.16)" />
            {displayedEdges.map((edge, index) => {
              const position = graphPosition(index);
              const labelPosition = relationshipGraphEdgeLabelPosition(position);
              const selected = edge.id === selectedEdgeId;
              const theme = relationshipKindTheme(edge.kind);
              return (
                <g key={edge.id}>
                  <path
                    d={graphPath(position)}
                    fill="none"
                    stroke={theme.accent}
                    strokeWidth={selected ? 3.8 : 2.4}
                    strokeOpacity={selected ? .96 : .58}
                    strokeDasharray={theme.dash}
                    onClick={() => onSelectEdge(edge.id)}
                    style={{ cursor: 'pointer' }}
                  />
                  <foreignObject x={labelPosition.x - (EDGE_LABEL_SIZE.width / 2)} y={labelPosition.y - (EDGE_LABEL_SIZE.height / 2)} width={EDGE_LABEL_SIZE.width} height={EDGE_LABEL_SIZE.height}>
                    <button type="button" onClick={() => onSelectEdge(edge.id)} style={{ width: '100%', height: 26, border: `1px solid ${selected ? theme.accent : theme.border}`, borderRadius: 999, background: 'rgba(255,252,244,.96)', color: theme.ink, fontSize: 11, fontWeight: 900, fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      {relationKindLabel(t, edge.kind)}
                    </button>
                  </foreignObject>
                </g>
              );
            })}
            {displayedEdges.length === 0 ? (
              <text x={GRAPH_CENTER.x} y={GRAPH_CENTER.y + 120} textAnchor="middle" fill={PAPER.faint} fontSize="16" fontWeight="700">
                {t('WorldDetail.paper.relationshipExplorer.network.noFilteredEdges')}
              </text>
            ) : null}
            <foreignObject x={GRAPH_CENTER.x - 92} y={GRAPH_CENTER.y - 92} width="184" height="184">
              <button type="button" onClick={() => onSelectCharacter(center.id)} style={{ width: '100%', height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', display: 'grid', placeItems: 'center' }}>
                <div style={{ width: 136, height: 136, borderRadius: '50%', background: 'radial-gradient(circle at 50% 35%, #2f8257, #145033 72%)', border: '6px solid rgba(255,253,247,.92)', boxShadow: '0 0 0 2px rgba(37,99,77,.20), 0 18px 36px rgba(25,70,45,.22)', display: 'grid', placeItems: 'center', color: '#fffef8', textAlign: 'center' }}>
                  <span style={{ maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: PAPER_SERIF, fontSize: 29, fontWeight: 950 }}>{center.name}</span>
                </div>
              </button>
            </foreignObject>
            {displayedEdges.map((edge, index) => {
              const position = graphPosition(index);
              const selected = edge.id === selectedEdgeId;
              const theme = relationshipKindTheme(edge.kind);
              const targetMeta = [edge.targetRole, edge.targetFaction].filter(Boolean).join(' · ') || t('WorldDetail.paper.relationshipExplorer.noTargetMeta');
              return (
                <foreignObject key={`${edge.id}-node`} x={position.x - 94} y={position.y - 42} width="188" height="86">
                  <button
                    type="button"
                    onClick={() => (edge.targetIsWorldCharacter ? onSelectCharacter(edge.targetCharacterId) : onSelectEdge(edge.id))}
                    style={{
                      width: '100%',
                      minHeight: 78,
                      border: `1.5px solid ${selected ? theme.accent : theme.border}`,
                      borderRadius: edge.targetIsWorldCharacter ? 34 : 999,
                      background: theme.softBg,
                      color: PAPER.inkStrong,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      boxShadow: selected ? '0 14px 28px rgba(42,77,58,.16)' : '0 8px 20px rgba(86,75,52,.09)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 36, height: 36, borderRadius: 999, display: 'grid', placeItems: 'center', background: theme.accent, color: '#fffaf2', flexShrink: 0 }}>
                      <UserRound size={18} strokeWidth={2.4} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 950, color: theme.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{edge.targetName}</span>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: PAPER.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{targetMeta}</span>
                    </span>
                  </button>
                </foreignObject>
              );
            })}
          </g>
        </svg>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        {relationKindOptions.map((kind) => {
          const active = kind === relationKindFilter;
          return (
            <button key={kind} type="button" onClick={() => onRelationKindFilterChange(kind)} style={storyFilterChipStyle(active, kind)}>
              {relationFilterLabel(t, kind)}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" onClick={onResetView} style={{ border: 'none', background: 'transparent', color: PAPER.green, fontSize: 12.5, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>
          {t('WorldDetail.paper.relationshipExplorer.story.viewAllSystem', { count: allEdgeCount })} <IconArrow size={13} />
        </button>
      </div>
    </section>
  );
}

function PeoplePanel({
  buckets,
  totalCount,
  selectedId,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onSelect,
}: {
  readonly buckets: readonly WorldRelationshipEvidenceCharacterBucket[];
  readonly totalCount: number;
  readonly selectedId: string | null;
  readonly query: string;
  readonly filter: PeopleFilterKey;
  readonly onQueryChange: (value: string) => void;
  readonly onFilterChange: (filter: PeopleFilterKey) => void;
  readonly onSelect: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside style={{ ...panelStyle(), display: 'flex', flexDirection: 'column', minHeight: 0, height: 'calc(100vh - 92px)', position: 'sticky', top: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 14px 12px', borderBottom: `1px solid ${PAPER.divider}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 17, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.peopleList.title')}</h2>
          <span style={{ fontSize: 12, color: PAPER.faint, fontWeight: 700 }}>{buckets.length} / {totalCount}</span>
        </div>
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('WorldDetail.paper.relationshipExplorer.peopleList.searchPlaceholder')}
          aria-label={t('WorldDetail.paper.relationshipExplorer.peopleList.searchPlaceholder')}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '9px 12px',
            borderRadius: 10,
            border: `1px solid ${PAPER.border}`,
            background: PAPER.cardSoft,
            color: PAPER.ink,
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 11 }}>
          {FILTER_KEYS.map((key) => {
            const active = key === filter;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onFilterChange(key)}
                style={filterChipStyle(active)}
              >
                {t(`WorldDetail.paper.relationshipExplorer.peopleList.filters.${key}`)}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10 }}>
        {buckets.length > 0 ? (
          <div style={{ display: 'grid', gap: 4 }}>
            {buckets.map((bucket) => {
              const selected = bucket.character.id === selectedId;
              const count = clueCount(bucket);
              return (
                <button
                  key={bucket.character.id}
                  type="button"
                  onClick={() => onSelect(bucket.character.id)}
                  style={{
                    width: '100%',
                    padding: '9px 16px 9px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    border: `1px solid ${selected ? PAPER.green : 'transparent'}`,
                    borderRadius: 12,
                    background: selected ? PAPER.greenSoftBg : 'transparent',
                  }}
                >
                  <PaperAvatar name={bucket.character.name} imageUrl={bucket.character.avatarUrl} size={38} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span data-testid="world-relationship-person-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
                      <span style={{ minWidth: 0, fontSize: 13, fontWeight: 900, color: PAPER.inkStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bucket.character.name}</span>
                      {count > 0 ? (
                        <span data-testid="world-relationship-person-count" style={{ flexShrink: 0, fontSize: 11, color: PAPER.green, fontWeight: 850, lineHeight: 1 }}>{t('WorldDetail.paper.relationshipExplorer.peopleList.clueCount', { count })}</span>
                      ) : null}
                    </span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: PAPER.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(bucket.character)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : <p style={{ margin: '20px 12px', fontSize: 12.5, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.peopleList.empty')}</p>}
      </div>
    </aside>
  );
}

function RelationshipDetail({
  edge,
  onBackToProfile,
  onOpenCharacter,
}: {
  readonly edge: WorldRelationshipEvidenceEdge;
  readonly onBackToProfile: () => void;
  readonly onOpenCharacter?: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  const works = extractWorkTitles(edge.evidenceTexts);
  const evidenceClues = edge.evidenceTexts.slice(0, 3);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={onBackToProfile}
          aria-label={t('WorldDetail.paper.relationshipExplorer.side.profile')}
          title={t('WorldDetail.paper.relationshipExplorer.side.profile')}
          style={{ ...paperGhostButton, width: 28, height: 28, padding: 0, justifyContent: 'center' }}
        >
          <IconChevron size={13} color={PAPER.green} />
        </button>
        <PaperTag>{t('WorldDetail.paper.relationshipExplorer.side.relationship')}</PaperTag>
      </div>
      <h3 style={{ margin: '12px 0 6px', fontFamily: PAPER_SERIF, fontSize: 20, fontWeight: 900, color: PAPER.inkStrong }}>{edge.sourceName} · {edge.targetName}</h3>
      <dl style={{ margin: 0, display: 'grid', gap: 13 }}>
        <div>
          <dt style={{ fontSize: 11, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.type')}</dt>
          <dd style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 900, color: PAPER.inkStrong }}>{relationKindLabel(t, edge.kind)}</dd>
        </div>
        <div>
          <dt style={{ fontSize: 11, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.description')}</dt>
          <dd style={{ margin: '6px 0 0', padding: 12, borderRadius: 12, background: PAPER.cardSoft, fontSize: 12.5, lineHeight: 1.65, color: PAPER.ink }}>{edge.evidenceTexts[0] ?? t('WorldDetail.paper.relationshipExplorer.relation.noEvidence')}</dd>
        </div>
        <div>
          <dt style={{ fontSize: 11, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.works')}</dt>
          <dd style={{ margin: '6px 0 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>{works.length > 0 ? works.map((work) => <PaperTag key={work} tone="neutral">{work}</PaperTag>) : <span style={{ fontSize: 12.5, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.noWorks')}</span>}</dd>
        </div>
      </dl>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${PAPER.divider}` }}>
        <div style={{ marginBottom: 10, fontSize: 13.5, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.relation.evidence')}</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {evidenceClues.map((text) => (
            <p key={text} style={{ margin: 0, padding: 12, borderRadius: 12, background: PAPER.cardSoft, fontSize: 12.5, lineHeight: 1.65, color: PAPER.ink }}>{text}</p>
          ))}
        </div>
      </div>
      {onOpenCharacter && edge.targetIsWorldCharacter ? (
        <button type="button" onClick={() => onOpenCharacter(edge.targetCharacterId)} style={{ ...paperPrimaryButton, width: '100%', marginTop: 16 }}>
          {t('WorldDetail.paper.relationshipExplorer.openCharacter')} <IconArrow size={13} />
        </button>
      ) : null}
    </>
  );
}

function ClueDetail({
  clue,
  onBackToProfile,
}: {
  readonly clue: WorldRelationshipEvidenceRecord;
  readonly onBackToProfile: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" onClick={onBackToProfile} style={{ ...paperGhostButton, padding: '5px 10px', fontSize: 11.5, marginBottom: 12 }}>
        <IconChevron size={13} color={PAPER.green} /> {t('WorldDetail.paper.relationshipExplorer.side.profile')}
      </button>
      <PaperTag tone="neutral">{t('WorldDetail.paper.relationshipExplorer.side.clue')}</PaperTag>
      <h3 style={{ margin: '12px 0 8px', fontFamily: PAPER_SERIF, fontSize: 20, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.clue.title')}</h3>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: PAPER.muted }}>{t('WorldDetail.paper.relationshipExplorer.clue.desc')}</p>
      <p style={{ margin: '14px 0 0', padding: 13, borderRadius: 12, background: PAPER.cardSoft, fontSize: 12.5, lineHeight: 1.7, color: PAPER.ink }}>{clue.evidenceText}</p>
      <div style={{ marginTop: 14, fontSize: 12, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.clue.continue', { name: clue.sourceName })}</div>
    </>
  );
}

function ProfileSummary({
  center,
  clues,
  edges,
  onOpenCharacter,
  onBrowsePeers,
  onSelectEdge,
  onSelectClue,
}: {
  readonly center: WorldCharacter;
  readonly clues: readonly CenterClue[];
  readonly edges: readonly WorldRelationshipEvidenceEdge[];
  readonly onOpenCharacter?: (characterId: string) => void;
  readonly onBrowsePeers: () => void;
  readonly onSelectEdge: (edgeId: string) => void;
  readonly onSelectClue: (clueId: string) => void;
}) {
  const { t } = useTranslation();
  const primaryClues = clues.slice(0, 3);
  const relationOverview = KIND_ORDER.map((kind) => ({
    kind,
    count: edges.filter((edge) => edge.kind === kind).length,
  })).filter((item) => item.count > 0);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <PaperAvatar name={center.name} imageUrl={center.avatarUrl} size={52} />
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 20, fontWeight: 900, color: PAPER.inkStrong }}>{center.name}</h3>
          <div style={{ marginTop: 4, fontSize: 12, color: PAPER.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(center)}</div>
        </div>
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 12.8, lineHeight: 1.75, color: PAPER.muted }}>{center.bio || t('WorldDetail.paper.relationshipExplorer.profile.defaultIntro')}</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
        {identityTags(center, t).map((tag) => <PaperTag key={tag} tone="neutral">{tag}</PaperTag>)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={() => onOpenCharacter?.(center.id)} style={{ ...paperPrimaryButton, flex: 1 }}>
          {t('WorldDetail.paper.relationshipExplorer.profile.viewProfile')} <IconArrow size={13} />
        </button>
        <button type="button" onClick={onBrowsePeers} style={paperGhostButton}>
          {t('WorldDetail.paper.relationshipExplorer.profile.peers')}
        </button>
      </div>

      <div style={{ marginTop: 18, paddingTop: 15, borderTop: `1px solid ${PAPER.divider}` }}>
        <div style={{ marginBottom: 10, fontSize: 13.5, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.profile.relationshipOverview')}</div>
        {relationOverview.length > 0 ? (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {relationOverview.map((item) => (
              <PaperTag key={item.kind} tone="neutral">{relationKindLabel(t, item.kind)} · {item.count}</PaperTag>
            ))}
          </div>
        ) : <p style={{ margin: 0, fontSize: 12.5, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.profile.noRelationshipOverview')}</p>}
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${PAPER.divider}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.clueList.title')}</h4>
          <span style={{ fontSize: 11.5, color: PAPER.faint, fontWeight: 700 }}>{t('WorldDetail.paper.relationshipExplorer.clueList.limitedCount', { shown: primaryClues.length, total: clues.length })}</span>
        </div>
        {primaryClues.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {primaryClues.map((clue) => (
              <button
                key={clue.id}
                type="button"
                onClick={() => (clue.edgeId ? onSelectEdge(clue.edgeId) : clue.clueId ? onSelectClue(clue.clueId) : undefined)}
                style={{ ...softPanelStyle(), padding: 12, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: PAPER.inkStrong }}>{center.name}</span>
                  <PaperTag tone="neutral">{relationKindLabel(t, clue.kind)}</PaperTag>
                </div>
                <div style={{ fontSize: 12.3, lineHeight: 1.6, color: PAPER.muted }}>{clue.text}</div>
              </button>
            ))}
          </div>
        ) : <p style={{ margin: 0, fontSize: 12.5, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.clueList.empty')}</p>}
      </div>
    </>
  );
}

function RelationshipDetailPanel({
  activeLabel,
  children,
}: {
  readonly activeLabel: string;
  readonly children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <aside data-testid="world-relationship-detail-panel" aria-expanded={true} style={{ ...panelStyle(), height: 'calc(100vh - 92px)', position: 'sticky', top: 12, alignSelf: 'start', display: 'grid', gridTemplateRows: 'auto 1fr', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 14px 11px', borderBottom: `1px solid ${PAPER.divider}` }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.side.detail')}</div>
          <div style={{ marginTop: 3, fontSize: 13, fontWeight: 900, color: PAPER.inkStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeLabel}</div>
        </div>
      </div>
      <div style={{ minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {children}
      </div>
    </aside>
  );
}

function TopStat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: PAPER_SERIF, fontSize: 18, fontWeight: 900, color: PAPER.inkStrong, lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: PAPER.muted, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

export function WorldRelationshipExplorer({
  world,
  characters,
  history,
  onBack,
  onSelectCharacter,
}: WorldRelationshipExplorerProps) {
  const { t } = useTranslation();
  const [selectedCenterId, setSelectedCenterId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedClueId, setSelectedClueId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PeopleFilterKey>('all');
  const [relationKindFilter, setRelationKindFilter] = useState<RelationFilterKey>('all');
  const [zoomScale, setZoomScale] = useState(GRAPH_DEFAULT_ZOOM);
  const [detailCollapsed, setDetailCollapsed] = useState(true);
  const graph = useMemo(() => buildWorldRelationshipEvidenceGraph({
    world,
    characters,
    history,
    preferredCenterId: selectedCenterId,
  }), [characters, history, selectedCenterId, world]);
  const centerId = graph.center?.id ?? null;
  const buckets = useMemo(() => [
    ...graph.density.linked,
    ...graph.density.clueOnly,
    ...graph.density.empty,
  ], [graph.density.clueOnly, graph.density.empty, graph.density.linked]);
  const visibleBuckets = useMemo(
    () => buckets.filter((bucket) => (
      bucketMatchesFilter(bucket, filter)
      && bucketMatchesQuery(bucket, query)
    )),
    [buckets, filter, query],
  );
  const relationKindOptions = useMemo<RelationFilterKey[]>(() => {
    const available = new Set<WorldRelationshipEvidenceKind>();
    buckets.forEach((bucket) => {
      if (bucket.primaryKind) {
        available.add(bucket.primaryKind);
      }
    });
    KIND_ORDER.forEach((kind) => {
      if (graph.kindCounts[kind] > 0) {
        available.add(kind);
      }
    });
    return RELATION_FILTER_KEYS.filter((kind) => kind === 'all' || available.has(kind));
  }, [buckets, graph.kindCounts]);
  const visibleEdges = useMemo(
    () => relationKindFilter === 'all'
      ? graph.edges
      : graph.edges.filter((edge) => edge.kind === relationKindFilter),
    [graph.edges, relationKindFilter],
  );
  const selectedEdge = selectedEdgeId ? graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null;
  const selectedClue = selectedClueId ? graph.unlinkedEvidence.find((record) => record.id === selectedClueId) ?? null : null;
  const totalClues = buckets.reduce((sum, bucket) => sum + clueCount(bucket), 0);
  const featuredCount = buckets.filter((bucket) => bucket.character.importance === 'PRIMARY').length;
  const centerClues = useMemo<CenterClue[]>(() => dedupeCenterClues([
    ...graph.edges.map((edge) => ({
      id: `edge:${edge.id}`,
      kind: edge.kind,
      text: edge.evidenceTexts[0] ?? '',
      edgeId: edge.id,
      clueId: null,
    })),
    ...graph.unlinkedEvidence.map((record) => ({
      id: `clue:${record.id}`,
      kind: record.kind,
      text: record.evidenceText,
      edgeId: null,
      clueId: record.id,
    })),
  ]), [graph.edges, graph.unlinkedEvidence]);

  const selectCenter = (characterId: string) => {
    setSelectedCenterId(characterId);
    setSelectedEdgeId(null);
    setSelectedClueId(null);
    setDetailCollapsed(false);
  };
  const selectEdge = (edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedClueId(null);
    setDetailCollapsed(false);
  };
  const selectClue = (recordId: string) => {
    setSelectedClueId(recordId);
    setSelectedEdgeId(null);
    setDetailCollapsed(false);
  };
  const clearSelection = () => {
    setSelectedEdgeId(null);
    setSelectedClueId(null);
    setDetailCollapsed(true);
  };
  const browsePeers = () => {
    setFilter('all');
    setQuery('');
  };
  const zoomIn = () => setZoomScale((value) => clampZoom(value + .12));
  const zoomOut = () => setZoomScale((value) => clampZoom(value - .12));
  const resetView = () => {
    setZoomScale(GRAPH_DEFAULT_ZOOM);
    setRelationKindFilter('all');
    setSelectedEdgeId(null);
    setSelectedClueId(null);
    setDetailCollapsed(true);
  };
  const activeDetailLabel = selectedEdge
    ? `${selectedEdge.sourceName} · ${selectedEdge.targetName}`
    : selectedClue
      ? t('WorldDetail.paper.relationshipExplorer.side.clue')
      : graph.center?.name ?? t('WorldDetail.paper.relationshipExplorer.side.profile');
  const expandedExplorerLayoutStyle = {
    gridTemplateColumns: 'minmax(212px,244px) minmax(0,1fr) minmax(300px,340px)',
  };
  const collapsedExplorerColumns = 'minmax(212px,244px) minmax(0,1fr)';

  return (
    <div style={{ minHeight: '100%', color: PAPER.ink, background: 'linear-gradient(135deg, #f4efe2 0%, #eef4ee 48%, #f8f4e9 100%)' }}>
      <header data-testid="world-relationship-topbar" style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,auto) minmax(0,1fr) auto', alignItems: 'center', gap: 18, padding: '9px 18px', minHeight: 58, borderBottom: `1px solid ${PAPER.border}`, background: 'rgba(255,253,247,.82)', backdropFilter: 'blur(10px)' }}>
        <button type="button" onClick={onBack} style={{ ...paperGhostButton, border: 'none', background: 'transparent', padding: '4px 6px', color: PAPER.muted, justifyContent: 'flex-start' }}>
          <IconChevron size={14} color={PAPER.green} /> {t('WorldDetail.paper.relationshipExplorer.back')}
        </button>
        <div style={{ minWidth: 0, textAlign: 'center' }}>
          <div style={{ fontFamily: PAPER_SERIF, fontSize: 15.5, fontWeight: 900, color: PAPER.inkStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('WorldDetail.paper.relationshipExplorer.title')}</div>
          <div style={{ marginTop: 3, fontSize: 11.5, color: PAPER.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('WorldDetail.paper.relationshipExplorer.topbar.current', { name: graph.center?.name ?? '--' })}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
          <TopStat value={formatNum(graph.summary.worldCharacterCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.people')} />
          <TopStat value={formatNum(graph.summary.relationshipCount || graph.summary.linkedEvidenceCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.relationships')} />
          <TopStat value={formatNum(totalClues)} label={t('WorldDetail.paper.relationshipExplorer.metrics.clues')} />
          <TopStat value={formatNum(featuredCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.featured')} />
        </div>
      </header>

      <div style={{ display: 'grid', ...expandedExplorerLayoutStyle, gridTemplateColumns: detailCollapsed ? collapsedExplorerColumns : expandedExplorerLayoutStyle.gridTemplateColumns, gap: 12, alignItems: 'start', padding: 12 }}>
        <PeoplePanel
          buckets={visibleBuckets}
          totalCount={buckets.length}
          selectedId={centerId}
          query={query}
          filter={filter}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          onSelect={selectCenter}
        />

        <main style={{ minWidth: 0 }}>
          {graph.center ? (
            graph.edges.length > 0 ? (
              <RelationshipNetwork
                center={graph.center}
                edges={visibleEdges}
                allEdgeCount={graph.edges.length}
                relationKindFilter={relationKindFilter}
                relationKindOptions={relationKindOptions}
                zoomScale={zoomScale}
                detailCollapsed={detailCollapsed}
                selectedEdgeId={selectedEdgeId}
                onSelectEdge={selectEdge}
                onSelectCharacter={selectCenter}
                onRelationKindFilterChange={setRelationKindFilter}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onResetView={resetView}
                onToggleDetailPanel={() => setDetailCollapsed((value) => !value)}
              />
            ) : (
              <ProfileFallback center={graph.center} characters={characters} onSelect={selectCenter} onOpenProfile={onSelectCharacter} />
            )
          ) : (
            <div style={{ ...panelStyle(), padding: 24 }}>
              <h2 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 18, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersTitle')}</h2>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.65, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersDesc')}</p>
            </div>
          )}
        </main>

        {!detailCollapsed ? (
          <RelationshipDetailPanel activeLabel={activeDetailLabel}>
            {graph.center ? (
              selectedEdge ? (
                <RelationshipDetail edge={selectedEdge} onBackToProfile={clearSelection} onOpenCharacter={onSelectCharacter} />
              ) : selectedClue ? (
                <ClueDetail clue={selectedClue} onBackToProfile={clearSelection} />
              ) : (
                <ProfileSummary
                  center={graph.center}
                  clues={centerClues}
                  edges={graph.edges}
                  onOpenCharacter={onSelectCharacter}
                  onBrowsePeers={browsePeers}
                  onSelectEdge={selectEdge}
                  onSelectClue={selectClue}
                />
              )
            ) : (
              <p style={{ margin: 0, fontSize: 12.8, lineHeight: 1.7, color: PAPER.muted }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersDesc')}</p>
            )}
          </RelationshipDetailPanel>
        ) : null}
      </div>
    </div>
  );
}
