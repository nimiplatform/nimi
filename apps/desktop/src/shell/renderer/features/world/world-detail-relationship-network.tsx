import { useTranslation } from 'react-i18next';
import { BookOpen, Minus, PanelRightClose, PanelRightOpen, Plus, RotateCcw, UserRound } from 'lucide-react';
import type { WorldRelationshipEvidenceEdge, WorldRelationshipEvidenceKind } from './world-detail-relationship-model.js';
import type { WorldCharacter } from './world-detail-types.js';
import {
  EDGE_LABEL_SIZE,
  EXPLORER_GRAPH_CANVAS_MIN_HEIGHT_PX,
  EXPLORER_PANEL_HEIGHT_PX,
  GRAPH_CENTER,
  graphPath,
  graphPosition,
  panelStyle,
  relationFilterLabel,
  relationKindLabel,
  relationshipGraphEdgeLabelPosition,
  relationshipKindTheme,
  storyFilterChipStyle,
  toolButtonStyle,
  type RelationFilterKey,
} from './world-detail-relationship-explorer-model.js';

export function RelationshipNetwork({
  center,
  edges,
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
        height: EXPLORER_PANEL_HEIGHT_PX,
        minHeight: EXPLORER_PANEL_HEIGHT_PX,
        boxSizing: 'border-box',
        padding: 22,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(55% 42% at 52% 8%, color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent), transparent 60%),'
          + 'var(--nimi-surface-card)',
      }}
    >
      <div data-testid="world-relationship-graph-toolbar" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent)', color: 'var(--nimi-action-primary-bg)', flexShrink: 0 }}>
            <BookOpen size={16} strokeWidth={2.2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.25, fontWeight: 950, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.story.title')}</h2>
            <p style={{ margin: '8px 0 0', maxWidth: 620, fontSize: 12.8, lineHeight: 1.65, color: 'var(--nimi-text-muted)' }}>
              {t('WorldDetail.paper.relationshipExplorer.story.subtitle', { name: center.name })}
            </p>
          </div>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: 10, flexShrink: 0 }}>
          <div data-testid="world-relationship-kind-legend" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {legendKinds.map((kind) => {
              const theme = relationshipKindTheme(kind);
              return (
                <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--nimi-text-muted)', fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start', marginBottom: 16 }}>
        {relationKindOptions.map((kind) => {
          const active = kind === relationKindFilter;
          return (
            <button key={kind} type="button" onClick={() => onRelationKindFilterChange(kind)} style={storyFilterChipStyle(active, kind)}>
              {relationFilterLabel(t, kind)}
            </button>
          );
        })}
      </div>
      <div style={{ flex: '1 1 360px', minHeight: EXPLORER_GRAPH_CANVAS_MIN_HEIGHT_PX, border: '1px solid var(--nimi-border-subtle)', borderRadius: 22, overflow: 'hidden', background: 'linear-gradient(180deg, color-mix(in srgb, var(--nimi-surface-card) 72%, transparent), color-mix(in srgb, var(--nimi-surface-panel) 60%, transparent))' }}>
        <svg
          viewBox="0 0 1000 1000"
          role="img"
          aria-label={t('WorldDetail.paper.relationshipExplorer.graphLabel')}
          style={{ width: '100%', height: '100%', minHeight: EXPLORER_GRAPH_CANVAS_MIN_HEIGHT_PX, display: 'block' }}
        >
          <g transform={`translate(${GRAPH_CENTER.x} ${GRAPH_CENTER.y}) scale(${zoomScale}) translate(${-GRAPH_CENTER.x} ${-GRAPH_CENTER.y})`}>
            <circle cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} r="138" fill="none" stroke="color-mix(in srgb, var(--nimi-action-primary-bg) 18%, transparent)" />
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
                    <button type="button" onClick={() => onSelectEdge(edge.id)} style={{ width: '100%', height: 26, border: `1px solid ${selected ? theme.accent : theme.border}`, borderRadius: 999, background: 'var(--nimi-surface-card)', color: theme.ink, fontSize: 11, fontWeight: 900, fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      {relationKindLabel(t, edge.kind)}
                    </button>
                  </foreignObject>
                </g>
              );
            })}
            {displayedEdges.length === 0 ? (
              <text x={GRAPH_CENTER.x} y={GRAPH_CENTER.y + 120} textAnchor="middle" fill="var(--nimi-text-muted)" fontSize="16" fontWeight="700">
                {t('WorldDetail.paper.relationshipExplorer.network.noFilteredEdges')}
              </text>
            ) : null}
            <foreignObject x={GRAPH_CENTER.x - 92} y={GRAPH_CENTER.y - 92} width="184" height="184">
              <button type="button" onClick={() => onSelectCharacter(center.id)} style={{ width: '100%', height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', display: 'grid', placeItems: 'center' }}>
                <div style={{ width: 136, height: 136, borderRadius: '50%', background: 'radial-gradient(circle at 50% 35%, var(--nimi-action-primary-bg), var(--nimi-action-primary-bg-hover) 72%)', border: '6px solid var(--nimi-surface-card)', boxShadow: '0 0 0 2px color-mix(in srgb, var(--nimi-action-primary-bg) 18%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--nimi-action-primary-text)', textAlign: 'center' }}>
                  <span style={{ maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 29, fontWeight: 950 }}>{center.name}</span>
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
                      color: 'var(--nimi-text-primary)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      boxShadow: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 36, height: 36, borderRadius: 999, display: 'grid', placeItems: 'center', background: theme.accent, color: 'var(--nimi-text-inverse)', flexShrink: 0 }}>
                      <UserRound size={18} strokeWidth={2.4} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 950, color: theme.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{edge.targetName}</span>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{targetMeta}</span>
                    </span>
                  </button>
                </foreignObject>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
