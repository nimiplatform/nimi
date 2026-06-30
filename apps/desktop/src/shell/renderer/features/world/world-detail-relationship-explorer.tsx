import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
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

type GraphPosition = {
  readonly x: number;
  readonly y: number;
};

type CenterClue = {
  readonly id: string;
  readonly kind: WorldRelationshipEvidenceKind;
  readonly text: string;
  readonly edgeId: string | null;
  readonly clueId: string | null;
};

const FILTER_KEYS: readonly PeopleFilterKey[] = ['all', 'featured', 'literati', 'academy', 'open'];

const GRAPH_CENTER: GraphPosition = { x: 500, y: 326 };
const GRAPH_POSITIONS: readonly GraphPosition[] = [
  { x: 690, y: 132 },
  { x: 794, y: 326 },
  { x: 690, y: 520 },
  { x: 500, y: 576 },
  { x: 310, y: 520 },
  { x: 206, y: 326 },
  { x: 310, y: 132 },
  { x: 500, y: 76 },
];

const KIND_COLORS: Record<WorldRelationshipEvidenceKind, string> = {
  association: '#4f78c9',
  kinship: '#8d68c8',
  office: '#4aa371',
  text: '#c98a36',
  entry: '#ba7b28',
  address: '#4c9a96',
  status: '#68736f',
  topic: '#8d7a52',
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

function relationKindLabel(t: ReturnType<typeof useTranslation>['t'], kind: WorldRelationshipEvidenceKind): string {
  return t(`WorldDetail.paper.relationshipExplorer.kinds.${kind}`);
}

function graphPosition(index: number): GraphPosition {
  return GRAPH_POSITIONS[index] ?? GRAPH_POSITIONS[index % GRAPH_POSITIONS.length] ?? GRAPH_CENTER;
}

function graphPath(position: GraphPosition): string {
  const controlX = (GRAPH_CENTER.x + position.x) / 2;
  return `M ${GRAPH_CENTER.x} ${GRAPH_CENTER.y} C ${controlX} ${GRAPH_CENTER.y} ${controlX} ${position.y} ${position.x} ${position.y}`;
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
  selectedEdgeId,
  onSelectEdge,
  onSelectCharacter,
}: {
  readonly center: WorldCharacter;
  readonly edges: readonly WorldRelationshipEvidenceEdge[];
  readonly selectedEdgeId: string | null;
  readonly onSelectEdge: (edgeId: string) => void;
  readonly onSelectCharacter: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ ...panelStyle(), overflow: 'hidden', minHeight: 500 }}>
      <svg viewBox="0 0 1000 660" role="img" aria-label={t('WorldDetail.paper.relationshipExplorer.graphLabel')} style={{ width: '100%', height: 500, display: 'block', background: 'radial-gradient(circle at 50% 45%, rgba(235,226,200,.82), rgba(248,246,238,.94) 48%, rgba(230,238,232,.84))' }}>
        <circle cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} r="190" fill="none" stroke="rgba(120,108,80,.2)" strokeDasharray="4 10" />
        {edges.slice(0, 8).map((edge, index) => {
          const position = graphPosition(index);
          const selected = edge.id === selectedEdgeId;
          return (
            <g key={edge.id}>
              <path d={graphPath(position)} fill="none" stroke={KIND_COLORS[edge.kind]} strokeWidth={selected ? 4 : 2.4} strokeOpacity={selected ? .95 : .58} strokeDasharray={edge.kind === 'text' ? '8 7' : undefined} onClick={() => onSelectEdge(edge.id)} style={{ cursor: 'pointer' }} />
              <foreignObject x={(GRAPH_CENTER.x + position.x) / 2 - 52} y={(GRAPH_CENTER.y + position.y) / 2 - 14} width="104" height="28">
                <button type="button" onClick={() => onSelectEdge(edge.id)} style={{ width: '100%', height: 26, border: `1px solid ${selected ? KIND_COLORS[edge.kind] : 'rgba(180,170,146,.74)'}`, borderRadius: 999, background: 'rgba(255,252,244,.9)', color: selected ? PAPER.inkStrong : PAPER.muted, fontSize: 11, fontWeight: 800, fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                  {relationKindLabel(t, edge.kind)}
                </button>
              </foreignObject>
            </g>
          );
        })}
        <foreignObject x={GRAPH_CENTER.x - 72} y={GRAPH_CENTER.y - 82} width="144" height="164">
          <button type="button" onClick={() => onSelectCharacter(center.id)} style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
            <div style={{ width: 110, height: 110, margin: '0 auto 9px', borderRadius: '50%', background: PAPER.avatarGradient, border: `3px solid ${PAPER.green}`, boxShadow: '0 14px 32px rgba(55,89,68,.22)', display: 'grid', placeItems: 'center', fontFamily: PAPER_SERIF, fontSize: 48, fontWeight: 900, color: PAPER.inkStrong }}>{center.name.slice(0, 1)}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: PAPER.inkStrong }}>{center.name}</div>
            <div style={{ marginTop: 2, fontSize: 11, color: PAPER.green, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(center)}</div>
          </button>
        </foreignObject>
        {edges.slice(0, 8).map((edge, index) => {
          const position = graphPosition(index);
          const selected = edge.id === selectedEdgeId;
          return (
            <foreignObject key={`${edge.id}-node`} x={position.x - 62} y={position.y - 76} width="124" height="152">
              <button type="button" onClick={() => onSelectCharacter(edge.targetCharacterId)} style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={{ width: 72, height: 72, margin: '0 auto 8px', borderRadius: '50%', background: PAPER.avatarGradient, border: `3px solid ${selected ? KIND_COLORS[edge.kind] : '#fff'}`, boxShadow: selected ? '0 10px 26px rgba(33,85,62,.28)' : '0 8px 20px rgba(97,88,65,.16)', display: 'grid', placeItems: 'center', fontFamily: PAPER_SERIF, fontSize: 31, fontWeight: 900, color: PAPER.ink }}>{edge.targetName.slice(0, 1)}</div>
                <div style={{ fontSize: 12.5, fontWeight: 900, color: PAPER.inkStrong }}>{edge.targetName}</div>
                <div style={{ marginTop: 2, fontSize: 10.5, color: PAPER.faint, minHeight: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[edge.targetRole, edge.targetFaction].filter(Boolean).join(' · ') || t('WorldDetail.paper.relationshipExplorer.noTargetMeta')}</div>
              </button>
            </foreignObject>
          );
        })}
      </svg>
    </div>
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
    <aside style={{ ...panelStyle(), display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'calc(100vh - 96px)', position: 'sticky', top: 16, overflow: 'hidden' }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${PAPER.divider}` }}>
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {FILTER_KEYS.map((key) => {
            const active = key === filter;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onFilterChange(key)}
                style={{
                  border: `1px solid ${active ? PAPER.green : PAPER.border}`,
                  background: active ? PAPER.green : PAPER.card,
                  color: active ? '#f6f2e7' : PAPER.muted,
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: '5px 11px',
                }}
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
                    padding: '9px 10px',
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
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 900, color: PAPER.inkStrong }}>{bucket.character.name}</span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: PAPER.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(bucket.character)}</span>
                  </span>
                  {count > 0 ? (
                    <span style={{ fontSize: 11, color: PAPER.green, fontWeight: 800, whiteSpace: 'nowrap' }}>{t('WorldDetail.paper.relationshipExplorer.peopleList.clueCount', { count })}</span>
                  ) : null}
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
  return (
    <>
      <button type="button" onClick={onBackToProfile} style={{ ...paperGhostButton, padding: '5px 10px', fontSize: 11.5, marginBottom: 12 }}>
        <IconChevron size={13} color={PAPER.green} /> {t('WorldDetail.paper.relationshipExplorer.side.profile')}
      </button>
      <PaperTag>{t('WorldDetail.paper.relationshipExplorer.side.relationship')}</PaperTag>
      <h3 style={{ margin: '12px 0 6px', fontFamily: PAPER_SERIF, fontSize: 20, fontWeight: 900, color: PAPER.inkStrong }}>{edge.sourceName} · {edge.targetName}</h3>
      <dl style={{ margin: 0, display: 'grid', gap: 13 }}>
        <div>
          <dt style={{ fontSize: 11, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.type')}</dt>
          <dd style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 900, color: PAPER.inkStrong }}>{relationKindLabel(t, edge.kind)}</dd>
        </div>
        <div>
          <dt style={{ fontSize: 11, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.confidence')}</dt>
          <dd style={{ margin: '4px 0 0', fontSize: 13, color: PAPER.muted }}>{edge.weight >= 24 ? t('WorldDetail.paper.relationshipExplorer.relation.confidenceHigh') : t('WorldDetail.paper.relationshipExplorer.relation.confidenceNormal')}</dd>
        </div>
        <div>
          <dt style={{ fontSize: 11, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.source')}</dt>
          <dd style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.65, color: PAPER.muted }}>{t('WorldDetail.paper.relationshipExplorer.relation.sourceDesc')}</dd>
        </div>
        <div>
          <dt style={{ fontSize: 11, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.works')}</dt>
          <dd style={{ margin: '6px 0 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>{works.length > 0 ? works.map((work) => <PaperTag key={work} tone="neutral">{work}</PaperTag>) : <span style={{ fontSize: 12.5, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.relation.noWorks')}</span>}</dd>
        </div>
      </dl>
      {edge.evidenceTexts.slice(0, 2).map((text) => (
        <p key={text} style={{ margin: '12px 0 0', padding: 12, borderRadius: 12, background: PAPER.cardSoft, fontSize: 12.5, lineHeight: 1.65, color: PAPER.ink }}>{text}</p>
      ))}
      {onOpenCharacter ? (
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
  onOpenCharacter,
  onBrowsePeers,
  onSelectEdge,
  onSelectClue,
}: {
  readonly center: WorldCharacter;
  readonly clues: readonly CenterClue[];
  readonly onOpenCharacter?: (characterId: string) => void;
  readonly onBrowsePeers: () => void;
  readonly onSelectEdge: (edgeId: string) => void;
  readonly onSelectClue: (clueId: string) => void;
}) {
  const { t } = useTranslation();
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

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${PAPER.divider}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.clueList.title')}</h4>
          <span style={{ fontSize: 11.5, color: PAPER.faint, fontWeight: 700 }}>{t('WorldDetail.paper.relationshipExplorer.clueList.count', { count: clues.length })}</span>
        </div>
        {clues.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {clues.map((clue) => (
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

function HeroStat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: PAPER_SERIF, fontSize: 26, fontWeight: 800, color: PAPER.inkStrong, lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 5, fontSize: 11.5, color: PAPER.muted, whiteSpace: 'nowrap' }}>{label}</div>
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
    () => buckets.filter((bucket) => bucketMatchesFilter(bucket, filter) && bucketMatchesQuery(bucket, query)),
    [buckets, filter, query],
  );
  const selectedEdge = selectedEdgeId ? graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null;
  const selectedClue = selectedClueId ? graph.unlinkedEvidence.find((record) => record.id === selectedClueId) ?? null : null;
  const activeKinds = KIND_ORDER.filter((kind) => graph.kindCounts[kind] > 0);
  const totalClues = buckets.reduce((sum, bucket) => sum + clueCount(bucket), 0);
  const featuredCount = buckets.filter((bucket) => bucket.character.importance === 'PRIMARY').length;
  const centerClues = useMemo<CenterClue[]>(() => [
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
  ], [graph.edges, graph.unlinkedEvidence]);

  const selectCenter = (characterId: string) => {
    setSelectedCenterId(characterId);
    setSelectedEdgeId(null);
    setSelectedClueId(null);
  };
  const selectEdge = (edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedClueId(null);
  };
  const selectClue = (recordId: string) => {
    setSelectedClueId(recordId);
    setSelectedEdgeId(null);
  };
  const clearSelection = () => {
    setSelectedEdgeId(null);
    setSelectedClueId(null);
  };
  const browsePeers = () => {
    setFilter('all');
    setQuery('');
  };

  return (
    <div style={{ minHeight: '100%', color: PAPER.ink, background: 'linear-gradient(135deg, #f4efe2 0%, #eef4ee 48%, #f8f4e9 100%)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 24px', borderBottom: `1px solid ${PAPER.border}`, background: 'rgba(255,253,247,.7)' }}>
        <button type="button" onClick={onBack} style={{ ...paperGhostButton, border: 'none', background: 'transparent', padding: '4px 6px', color: PAPER.muted }}>
          <IconChevron size={14} color={PAPER.green} /> {t('WorldDetail.paper.relationshipExplorer.back')}
        </button>
        <div style={{ fontFamily: PAPER_SERIF, fontSize: 14.5, fontWeight: 900, color: PAPER.inkStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('WorldDetail.paper.relationshipExplorer.title')}</div>
        <div style={{ fontSize: 12, color: PAPER.faint, whiteSpace: 'nowrap' }}>
          {t('WorldDetail.paper.relationshipExplorer.eyebrow')} · {t('WorldDetail.paper.relationshipExplorer.worldKindStatic')}
        </div>
      </header>

      <section style={{ padding: '26px 24px 22px', background: 'linear-gradient(135deg, rgba(228,238,228,.9), rgba(238,242,226,.78) 55%, rgba(247,243,233,.6))', borderBottom: `1px solid ${PAPER.border}` }}>
        <h1 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 30, lineHeight: 1.12, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.title')}</h1>
        <p style={{ margin: '10px 0 0', maxWidth: 760, fontSize: 13.5, lineHeight: 1.75, color: PAPER.muted }}>{t('WorldDetail.paper.relationshipExplorer.subtitle')}</p>
        <div style={{ display: 'flex', gap: 40, marginTop: 20, flexWrap: 'wrap' }}>
          <HeroStat value={formatNum(graph.summary.worldCharacterCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.people')} />
          <HeroStat value={formatNum(graph.summary.relationshipCount || graph.summary.linkedEvidenceCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.relationships')} />
          <HeroStat value={formatNum(totalClues)} label={t('WorldDetail.paper.relationshipExplorer.metrics.clues')} />
          <HeroStat value={formatNum(featuredCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.featured')} />
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,300px) minmax(0,1fr) minmax(320px,360px)', gap: 16, alignItems: 'start', padding: 16 }}>
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

        <main style={{ minWidth: 0, display: 'grid', gap: 12 }}>
          <div style={{ ...panelStyle(), padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 4, height: 18, borderRadius: 2, background: PAPER.green, flexShrink: 0 }} />
              <h2 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 18, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.network.heading')}</h2>
            </div>
            {graph.center ? (
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.network.centerHint', { name: graph.center.name })}</p>
            ) : null}
            {activeKinds.length > 0 ? (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
                {activeKinds.map((kind) => (
                  <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: PAPER.muted, fontSize: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: KIND_COLORS[kind] }} />
                    {relationKindLabel(t, kind)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {graph.center ? (
            graph.edges.length > 0 ? (
              <RelationshipNetwork center={graph.center} edges={graph.edges} selectedEdgeId={selectedEdgeId} onSelectEdge={selectEdge} onSelectCharacter={selectCenter} />
            ) : (
              <ProfileFallback center={graph.center} characters={characters} onSelect={selectCenter} onOpenProfile={onSelectCharacter} />
            )
          ) : (
            <div style={{ ...panelStyle(), padding: 24 }}>
              <h2 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 18, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersTitle')}</h2>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.65, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersDesc')}</p>
            </div>
          )}

          {graph.center ? (
            <p style={{ margin: 0, padding: '0 4px', fontSize: 12, color: PAPER.faint }}>{t('WorldDetail.paper.relationshipExplorer.network.pickHint')}</p>
          ) : null}
        </main>

        <aside style={{ ...panelStyle(), padding: 20, position: 'sticky', top: 16, alignSelf: 'start' }}>
          {graph.center ? (
            selectedEdge ? (
              <RelationshipDetail edge={selectedEdge} onBackToProfile={clearSelection} onOpenCharacter={onSelectCharacter} />
            ) : selectedClue ? (
              <ClueDetail clue={selectedClue} onBackToProfile={clearSelection} />
            ) : (
              <ProfileSummary
                center={graph.center}
                clues={centerClues}
                onOpenCharacter={onSelectCharacter}
                onBrowsePeers={browsePeers}
                onSelectEdge={selectEdge}
                onSelectClue={selectClue}
              />
            )
          ) : (
            <p style={{ margin: 0, fontSize: 12.8, lineHeight: 1.7, color: PAPER.muted }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersDesc')}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
