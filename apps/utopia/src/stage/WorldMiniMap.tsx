import { useRef, useState } from 'react';
import type { NimiUtopiaResident, NimiUtopiaSnapshot } from '@nimiplatform/sdk/app';
import { CompassRoseIcon, LockClosedIcon } from '../components/UtopiaIcons.js';
import type { UtopiaDeclarativeStageV1 } from '../domain/bundle-validator.js';
import { resolveWorldLandmarks } from '../domain/world-landmarks.js';
import { buildPlaceOccupancyBreakdown } from './FallbackJournalStage.js';

export type UtopiaStageAnchorSpec = UtopiaDeclarativeStageV1['anchors'][number];

export type MiniMapViewportBox = Readonly<{
  readonly leftPercent: number;
  readonly topPercent: number;
  readonly widthPercent: number;
  readonly heightPercent: number;
}>;

export function WorldMiniMap(props: {
  readonly snapshot: NimiUtopiaSnapshot;
  readonly previewUrl: string | undefined;
  readonly anchors: readonly UtopiaStageAnchorSpec[];
  readonly viewportBox: MiniMapViewportBox;
  readonly selectedPlaceId: string | null;
  readonly selectedLandmarkId: string | null;
  readonly residentCoords: ReadonlyMap<string, { x: number; y: number }>;
  readonly onJumpToPercent: (xPercent: number, yPercent: number, instant?: boolean) => void;
  readonly onSelectPlace: (placeId: string) => void;
  readonly onSelectResident?: (resident: NimiUtopiaResident) => void;
}) {
  const {
    snapshot,
    previewUrl,
    anchors,
    viewportBox,
    selectedPlaceId,
    selectedLandmarkId,
    residentCoords,
    onJumpToPercent,
    onSelectPlace,
  } = props;

  const [collapsed, setCollapsed] = useState(false);
  const radarRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<number | null>(null);

  const openSet = new Set(snapshot.openPlaceIds);
  const placeMap = new Map(snapshot.habitat.places.map((p) => [p.id, p]));
  const landmarks = resolveWorldLandmarks(snapshot.habitat.habitatId);
  const totalSpots = anchors.length + landmarks.length;

  const jumpFromPointer = (clientX: number, clientY: number, instant: boolean) => {
    const el = radarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = Math.max(4, Math.min(96, ((clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(6, Math.min(94, ((clientY - rect.top) / rect.height) * 100));
    onJumpToPercent(xPct, yPct, instant);
  };

  if (collapsed) {
    return (
      <div className="utopia-minimap-collapsed-wrap">
        <button
          type="button"
          className="utopia-minimap-toggle-pill"
          aria-expanded={false}
          aria-label={`展开洞天缩略舆图（共 ${anchors.length} 处场所与 ${landmarks.length} 处风物）`}
          onClick={() => setCollapsed(false)}
        >
          <CompassRoseIcon size={13} />
          <span>舆图 · {anchors.length} 处场所</span>
        </button>
      </div>
    );
  }

  return (
    <aside className="utopia-minimap-card" aria-label="洞天缩略舆图与场所跳转">
      <div className="utopia-minimap-head">
        <span className="utopia-minimap-title">
          <CompassRoseIcon size={12} />
          <strong>洞天舆图</strong>
          <small>{anchors.length} 场所 · {landmarks.length} 风物</small>
        </span>
        <button
          type="button"
          className="utopia-minimap-collapse-btn"
          aria-expanded={true}
          aria-label="收起洞天缩略舆图"
          title={`当前共含 ${totalSpots} 处可探索地点，点击收起`}
          onClick={() => setCollapsed(true)}
        >
          收起
        </button>
      </div>

      <div
        ref={radarRef}
        className="utopia-minimap-radar"
        role="application"
        aria-label="点击或拖拽缩略图以移动画卷镜头"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('button')) return;
          e.stopPropagation();
          draggingRef.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          jumpFromPointer(e.clientX, e.clientY, false);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current !== e.pointerId) return;
          e.stopPropagation();
          jumpFromPointer(e.clientX, e.clientY, true);
        }}
        onPointerUp={(e) => {
          if (draggingRef.current !== e.pointerId) return;
          draggingRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={(e) => {
          if (draggingRef.current !== e.pointerId) return;
          draggingRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
      >
        {previewUrl && (
          <img
            src={previewUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="utopia-minimap-bg-img"
          />
        )}

        {/* Scenic Landmark Diamonds */}
        {landmarks.map((lm) => (
          <span
            key={lm.id}
            className={`utopia-minimap-landmark-dot ${selectedLandmarkId === lm.id ? 'is-selected' : ''}`}
            style={{ left: `${lm.xPercent}%`, top: `${lm.yPercent}%` }}
            title={`风物：${lm.name}`}
            aria-hidden="true"
          />
        ))}

        {/* Formal Place Pins */}
        {anchors.map((anchor) => {
          const isQuarter = anchor.targetId === 'personal-quarter';
          const isOpen = isQuarter ? true : openSet.has(anchor.targetId);
          const name = isQuarter
            ? snapshot.habitat.personalQuarter.name
            : (placeMap.get(anchor.targetId)?.name ?? anchor.targetId);
          const isSelected = selectedPlaceId === anchor.targetId;
          return (
            <button
              key={anchor.targetId}
              type="button"
              className={[
                'utopia-minimap-place-pin',
                isOpen ? 'is-open' : 'is-closed',
                isQuarter ? 'is-quarter' : '',
                isSelected ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              style={{ left: `${anchor.xPercent}%`, top: `${anchor.yPercent}%` }}
              aria-label={`定位至场所：${name}`}
              title={name}
              onClick={(e) => {
                e.stopPropagation();
                onSelectPlace(anchor.targetId);
              }}
            />
          );
        })}

        {/* Live Companion Dots */}
        {snapshot.residents.map((res) => {
          const pt = residentCoords.get(res.agentHandle);
          if (!pt) return null;
          return (
            <span
              key={res.agentHandle}
              className={`utopia-minimap-resident-dot ${res.solitary ? 'is-solitary' : ''}`}
              style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
              title={res.displayName}
              aria-hidden="true"
            />
          );
        })}

        {/* Live Camera Viewport Frame */}
        <div
          className="utopia-minimap-viewport-rect"
          style={{
            left: `${viewportBox.leftPercent.toFixed(1)}%`,
            top: `${viewportBox.topPercent.toFixed(1)}%`,
            width: `${viewportBox.widthPercent.toFixed(1)}%`,
            height: `${viewportBox.heightPercent.toFixed(1)}%`,
          }}
          aria-hidden="true"
        />
      </div>

      {/* Quick District / Place Jump Strip */}
      <div className="utopia-minimap-place-strip" role="group" aria-label="场所快捷跳转">
        {anchors.map((anchor) => {
          const isQuarter = anchor.targetId === 'personal-quarter';
          const isOpen = isQuarter ? true : openSet.has(anchor.targetId);
          const name = isQuarter
            ? snapshot.habitat.personalQuarter.name
            : (placeMap.get(anchor.targetId)?.name ?? anchor.targetId);
          const breakdown = buildPlaceOccupancyBreakdown(anchor.targetId, snapshot);
          const occCount = breakdown.sharedPairs.length * 2
            + breakdown.independentResidents.length
            + breakdown.privateResidents.length;
          const isSelected = selectedPlaceId === anchor.targetId;
          return (
            <button
              key={anchor.targetId}
              type="button"
              className={[
                'utopia-minimap-chip',
                isOpen ? 'is-open' : 'is-closed',
                isSelected ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onSelectPlace(anchor.targetId)}
              title={`${name}${isOpen ? '' : '（暂闭）'}`}
            >
              {!isOpen && <LockClosedIcon size={9} />}
              <span>{name}</span>
              {occCount > 0 && <em className="utopia-minimap-chip-count">{occCount}</em>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
