import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { EmptyState } from '@nimiplatform/kit/ui';
import {
  buildWorldRelationshipEvidenceGraph,
  type WorldRelationshipEvidenceCharacterBucket,
  type WorldRelationshipEvidenceEdge,
  type WorldRelationshipEvidenceKind,
  type WorldRelationshipEvidenceRecord,
} from './world-detail-relationship-model.js';
import type { WorldCharacter, WorldDetailData, WorldHistoryBundle } from './world-detail-types.js';
import { formatNum } from './world-detail-paper-model.js';
import { WORLD_DETAIL_PAPER_CONTENT_PADDING } from './world-detail-layout.js';
import {
  IconArrow,
  IconChevron,
  PaperAvatar,
  PaperTag,
  paperGhostButton,
  paperPrimaryButton,
} from './world-detail-paper-primitives.js';
import { characterMeta } from './world-detail-template-model.js';
import {
  bucketMatchesFilter,
  bucketMatchesQuery,
  clampZoom,
  clueCount,
  dedupeCenterClues,
  displayRelationshipEvidenceText,
  EXPLORER_PANEL_HEIGHT_PX,
  extractWorkTitles,
  FILTER_KEYS,
  filterChipStyle,
  GRAPH_DEFAULT_ZOOM,
  identityTags,
  KIND_ORDER,
  panelStyle,
  relatedLists,
  relationKindLabel,
  RELATION_FILTER_KEYS,
  softPanelStyle,
  type CenterClue,
  type PeopleFilterKey,
  type RelationFilterKey,
} from './world-detail-relationship-explorer-model.js';
import { RelationshipNetwork } from './world-detail-relationship-network.js';
export {
  displayRelationshipEvidenceText,
  relationshipGraphEdgeLabelPosition,
} from './world-detail-relationship-explorer-model.js';

type WorldRelationshipExplorerProps = {
  readonly world: WorldDetailData;
  readonly characters: readonly WorldCharacter[];
  readonly history: WorldHistoryBundle;
  readonly onBack: () => void;
  readonly onSelectCharacter?: (characterId: string) => void;
  readonly onViewCharacter?: (character: WorldCharacter) => void;
};

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
      <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{title}</div>
      {characters.length > 0 ? (
        <div style={{ display: 'grid', gap: 7 }}>
          {characters.map((character) => (
            <button key={character.id} type="button" onClick={() => onSelect(character.id)} style={{ ...softPanelStyle(), padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
              <PaperAvatar name={character.name} imageUrl={character.avatarUrl} size={30} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{character.name}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(character)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : <div style={{ fontSize: 12, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.noRelated')}</div>}
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
          <h3 style={{ margin: '10px 0 6px', fontSize: 24, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{center.name}</h3>
          <p style={{ margin: 0, maxWidth: 680, fontSize: 13.5, lineHeight: 1.75, color: 'var(--nimi-text-muted)' }}>{center.bio || t('WorldDetail.paper.relationshipExplorer.profile.defaultIntro')}</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)', gap: 14 }}>
        <div style={{ ...softPanelStyle(), padding: 15 }}>
          <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.identity')}</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            {tags.map((tag) => <PaperTag key={tag} tone="neutral">{tag}</PaperTag>)}
          </div>
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.materials')}</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--nimi-text-muted)', fontSize: 12.5, lineHeight: 1.7 }}>
            {(materials.length > 0 ? materials : [t('WorldDetail.paper.relationshipExplorer.profile.basicMaterial')]).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div style={{ ...softPanelStyle(), padding: 15 }}>
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.directions')}</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--nimi-text-muted)', fontSize: 12.5, lineHeight: 1.7 }}>
            {(directions.length > 0 ? directions : [t('WorldDetail.paper.relationshipExplorer.profile.defaultDirection')]).map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <button type="button" onClick={() => onOpenProfile?.(center.id)} style={{ ...paperPrimaryButton, color: 'var(--nimi-action-primary-text)' }}>
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
    <aside style={{ ...panelStyle(), display: 'flex', flexDirection: 'column', height: EXPLORER_PANEL_HEIGHT_PX, minHeight: EXPLORER_PANEL_HEIGHT_PX, boxSizing: 'border-box', position: 'sticky', top: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--nimi-border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.peopleList.title')}</h2>
          <span style={{ fontSize: 12, color: 'var(--nimi-text-muted)', fontWeight: 700 }}>{buckets.length} / {totalCount}</span>
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
            border: '1px solid var(--nimi-border-subtle)',
            background: 'var(--nimi-surface-panel)',
            color: 'var(--nimi-text-primary)',
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
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, scrollbarGutter: 'stable' }}>
        {buckets.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 4 }}>
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
                    boxSizing: 'border-box',
                    padding: '9px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    border: `1px solid ${selected ? 'var(--nimi-action-primary-bg)' : 'transparent'}`,
                    borderRadius: 12,
                    background: selected ? 'color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent)' : 'transparent',
                  }}
                >
                  <PaperAvatar name={bucket.character.name} imageUrl={bucket.character.avatarUrl} size={38} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span data-testid="world-relationship-person-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
                      <span style={{ minWidth: 0, fontSize: 13, fontWeight: 900, color: 'var(--nimi-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bucket.character.name}</span>
                      {count > 0 ? (
                        <span data-testid="world-relationship-person-count" style={{ flexShrink: 0, fontSize: 11, color: 'var(--nimi-action-primary-bg)', fontWeight: 850, lineHeight: 1 }}>{t('WorldDetail.paper.relationshipExplorer.peopleList.clueCount', { count })}</span>
                      ) : null}
                    </span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(bucket.character)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : <EmptyState title={t('WorldDetail.paper.relationshipExplorer.peopleList.empty')} style={{ margin: '20px 12px' }} />}
      </div>
    </aside>
  );
}

function RelationshipDetail({
  edge,
  onOpenCharacter,
}: {
  readonly edge: WorldRelationshipEvidenceEdge;
  readonly onOpenCharacter?: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  const works = extractWorkTitles(edge.evidenceTexts);
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <PaperTag>{t('WorldDetail.paper.relationshipExplorer.side.relationship')}</PaperTag>
      </div>
      <h3 style={{ margin: '12px 0 6px', fontSize: 20, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{edge.sourceName} · {edge.targetName}</h3>
      <dl style={{ margin: 0, display: 'grid', gap: 13 }}>
        <div>
          <dt style={{ fontSize: 11, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.relation.type')}</dt>
          <dd style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{relationKindLabel(t, edge.kind)}</dd>
        </div>
        <div>
          <dt style={{ fontSize: 11, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.relation.description')}</dt>
          <dd style={{ margin: '6px 0 0', padding: 12, borderRadius: 12, background: 'var(--nimi-surface-panel)', fontSize: 12.5, lineHeight: 1.65, color: 'var(--nimi-text-primary)' }}>{displayRelationshipEvidenceText(edge.evidenceTexts[0] ?? t('WorldDetail.paper.relationshipExplorer.relation.noEvidence'))}</dd>
        </div>
        <div>
          <dt style={{ fontSize: 11, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.relation.works')}</dt>
          <dd style={{ margin: '6px 0 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>{works.length > 0 ? works.map((work) => <PaperTag key={work} tone="neutral">{work}</PaperTag>) : <span style={{ fontSize: 12.5, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.relation.noWorks')}</span>}</dd>
        </div>
      </dl>
      {onOpenCharacter && edge.targetIsWorldCharacter ? (
        <button type="button" onClick={() => onOpenCharacter(edge.targetCharacterId)} style={{ ...paperPrimaryButton, width: '100%', marginTop: 16, color: 'var(--nimi-action-primary-text)' }}>
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
        <IconChevron size={13} color="var(--nimi-action-primary-bg)" /> {t('WorldDetail.paper.relationshipExplorer.side.profile')}
      </button>
      <PaperTag tone="neutral">{t('WorldDetail.paper.relationshipExplorer.side.clue')}</PaperTag>
      <h3 style={{ margin: '12px 0 8px', fontSize: 20, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.clue.title')}</h3>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.clue.desc')}</p>
      <p style={{ margin: '14px 0 0', padding: 13, borderRadius: 12, background: 'var(--nimi-surface-panel)', fontSize: 12.5, lineHeight: 1.7, color: 'var(--nimi-text-primary)' }}>{displayRelationshipEvidenceText(clue.evidenceText)}</p>
      <div style={{ marginTop: 14, fontSize: 12, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.clue.continue', { name: clue.sourceName })}</div>
    </>
  );
}

function ProfileSummary({
  center,
  clues,
  edges,
  onOpenCharacter,
  onSelectEdge,
  onSelectClue,
}: {
  readonly center: WorldCharacter;
  readonly clues: readonly CenterClue[];
  readonly edges: readonly WorldRelationshipEvidenceEdge[];
  readonly onOpenCharacter?: (characterId: string) => void;
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
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{center.name}</h3>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(center)}</div>
        </div>
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 12.8, lineHeight: 1.75, color: 'var(--nimi-text-muted)' }}>{center.bio || t('WorldDetail.paper.relationshipExplorer.profile.defaultIntro')}</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
        {identityTags(center, t).map((tag) => <PaperTag key={tag} tone="neutral">{tag}</PaperTag>)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={() => onOpenCharacter?.(center.id)} style={{ ...paperPrimaryButton, flex: 1, color: 'var(--nimi-action-primary-text)' }}>
          {t('WorldDetail.paper.relationshipExplorer.profile.viewProfile')} <IconArrow size={13} />
        </button>
      </div>

      <div style={{ marginTop: 18, paddingTop: 15, borderTop: '1px solid var(--nimi-border-subtle)' }}>
        <div style={{ marginBottom: 10, fontSize: 13.5, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.relationshipOverview')}</div>
        {relationOverview.length > 0 ? (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {relationOverview.map((item) => (
              <PaperTag key={item.kind} tone="neutral">{relationKindLabel(t, item.kind)} · {item.count}</PaperTag>
            ))}
          </div>
        ) : <p style={{ margin: 0, fontSize: 12.5, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.noRelationshipOverview')}</p>}
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--nimi-border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.clueList.title')}</h4>
          <span style={{ fontSize: 11.5, color: 'var(--nimi-text-muted)', fontWeight: 700 }}>{t('WorldDetail.paper.relationshipExplorer.clueList.limitedCount', { shown: primaryClues.length, total: clues.length })}</span>
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
                  <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{center.name}</span>
                  <PaperTag tone="neutral">{relationKindLabel(t, clue.kind)}</PaperTag>
                </div>
                <div style={{ fontSize: 12.3, lineHeight: 1.6, color: 'var(--nimi-text-muted)' }}>{displayRelationshipEvidenceText(clue.text)}</div>
              </button>
            ))}
          </div>
        ) : <EmptyState title={t('WorldDetail.paper.relationshipExplorer.clueList.empty')} />}
      </div>
    </>
  );
}

function RelationshipDetailPanel({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <aside data-testid="world-relationship-detail-panel" aria-expanded={true} style={{ ...panelStyle(), height: EXPLORER_PANEL_HEIGHT_PX, minHeight: EXPLORER_PANEL_HEIGHT_PX, boxSizing: 'border-box', position: 'sticky', top: 12, alignSelf: 'stretch', display: 'grid', gridTemplateRows: '1fr', overflow: 'hidden' }}>
      <div style={{ minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {children}
      </div>
    </aside>
  );
}

function TopStat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--nimi-text-primary)', lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

export function WorldRelationshipExplorer({
  world,
  characters,
  history,
  onBack,
  onSelectCharacter,
  onViewCharacter,
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

  const openCharacterProfile = (characterId: string) => {
    const character = characters.find((item) => item.id === characterId) ?? null;
    if (character && onViewCharacter) {
      onViewCharacter(character);
      return;
    }
    onSelectCharacter?.(characterId);
  };
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
  const zoomIn = () => setZoomScale((value) => clampZoom(value + .12));
  const zoomOut = () => setZoomScale((value) => clampZoom(value - .12));
  const resetView = () => {
    setZoomScale(GRAPH_DEFAULT_ZOOM);
    setRelationKindFilter('all');
    setSelectedEdgeId(null);
    setSelectedClueId(null);
    setDetailCollapsed(true);
  };
  const expandedExplorerLayoutStyle = {
    gridTemplateColumns: 'minmax(212px,244px) minmax(0,1fr) minmax(300px,340px)',
  };
  const collapsedExplorerColumns = 'minmax(212px,244px) minmax(0,1fr)';

  return (
    <div
      data-testid="world-relationship-explorer"
      style={{
        minHeight: '100%',
        color: 'var(--nimi-text-primary)',
        background: 'transparent',
        padding: WORLD_DETAIL_PAPER_CONTENT_PADDING,
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateRows: 'auto minmax(0,1fr)',
      }}
    >
      <header data-testid="world-relationship-topbar" style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,auto) minmax(0,1fr) auto', alignItems: 'center', gap: 18, padding: '9px 18px', minHeight: 58, background: 'transparent' }}>
        <button type="button" onClick={onBack} style={{ ...paperGhostButton, border: 'none', background: 'transparent', padding: '4px 6px', color: 'var(--nimi-text-muted)', justifyContent: 'flex-start' }}>
          <IconChevron size={14} color="var(--nimi-action-primary-bg)" /> {t('WorldDetail.paper.relationshipExplorer.back')}
        </button>
        <div style={{ minWidth: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 15.5, fontWeight: 900, color: 'var(--nimi-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{world.name}</div>
          <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('WorldDetail.paper.relationshipExplorer.topbar.current', { name: graph.center?.name ?? '--' })}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
          <TopStat value={formatNum(graph.summary.worldCharacterCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.people')} />
          <TopStat value={formatNum(graph.summary.relationshipCount || graph.summary.linkedEvidenceCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.relationships')} />
          <TopStat value={formatNum(totalClues)} label={t('WorldDetail.paper.relationshipExplorer.metrics.clues')} />
          <TopStat value={formatNum(featuredCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.featured')} />
        </div>
      </header>

      <div style={{ display: 'grid', ...expandedExplorerLayoutStyle, gridTemplateColumns: detailCollapsed ? collapsedExplorerColumns : expandedExplorerLayoutStyle.gridTemplateColumns, gap: 12, alignItems: 'stretch', paddingTop: 12, minHeight: EXPLORER_PANEL_HEIGHT_PX }}>
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
              <ProfileFallback center={graph.center} characters={characters} onSelect={selectCenter} onOpenProfile={openCharacterProfile} />
            )
          ) : (
            <div style={{ ...panelStyle(), padding: 24 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersTitle')}</h2>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.65, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersDesc')}</p>
            </div>
          )}
        </main>

        {!detailCollapsed ? (
          <RelationshipDetailPanel>
            {graph.center ? (
              selectedEdge ? (
                <RelationshipDetail edge={selectedEdge} onOpenCharacter={openCharacterProfile} />
              ) : selectedClue ? (
                <ClueDetail clue={selectedClue} onBackToProfile={clearSelection} />
              ) : (
                <ProfileSummary
                  center={graph.center}
                  clues={centerClues}
                  edges={graph.edges}
                  onOpenCharacter={openCharacterProfile}
                  onSelectEdge={selectEdge}
                  onSelectClue={selectClue}
                />
              )
            ) : (
              <p style={{ margin: 0, fontSize: 12.8, lineHeight: 1.7, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersDesc')}</p>
            )}
          </RelationshipDetailPanel>
        ) : null}
      </div>
    </div>
  );
}
