import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type {
  ConversationSourceFilter,
  ConversationSourceKind,
  ConversationTargetSummary,
} from '../types.js';

export const CANONICAL_SOURCE_LABELS: Record<ConversationSourceFilter, string> = {
  all: 'All',
  ai: 'AI',
  human: 'Human',
  agent: 'Agent',
};

type BubbleLayout = {
  left: number;
  top: number;
  size: number;
  labelTop: number;
  zIndex: number;
};

type BubbleLayoutResult = {
  items: Record<string, BubbleLayout>;
  height: number;
};

const BASE_SIZE = 120;
const LABEL_HEIGHT = 44;
const GAP = 14;
const CELL = BASE_SIZE + GAP;
const ROW_HEIGHT_FACTOR = 0.8660254;
const HOVER_SCALE = 1.45;
const PUSH_RADIUS = CELL * 2;
const PUSH_STRENGTH = 26;
const FISHEYE_RADIUS = CELL * 3.5;
const FISHEYE_MIN_SCALE = 0.78;
const FISHEYE_IDLE_SCALE = 0.88;

function SourceFilterPills(props: {
  activeFilter: ConversationSourceFilter;
  availableSources: readonly ConversationSourceKind[];
  onChange?: (filter: ConversationSourceFilter) => void;
}) {
  const filters: ConversationSourceFilter[] = ['all', ...props.availableSources];
  return (
    <div
      className="inline-flex flex-wrap gap-2 rounded-full border border-white/80 bg-white/80 p-1 shadow-[0_14px_32px_rgba(15,23,42,0.08)]"
      data-canonical-source-pills="true"
    >
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => props.onChange?.(filter)}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
            props.activeFilter === filter
              ? 'bg-emerald-500 text-white shadow-[0_10px_24px_rgba(16,185,129,0.22)]'
              : 'bg-transparent text-slate-600 hover:bg-slate-100/90',
          )}
        >
          {CANONICAL_SOURCE_LABELS[filter]}
        </button>
      ))}
    </div>
  );
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveUnreadBadge(unreadCount: ConversationTargetSummary['unreadCount']): string | null {
  if (typeof unreadCount !== 'number' || unreadCount <= 0) {
    return null;
  }
  return unreadCount > 99 ? '99+' : String(unreadCount);
}

function resolveOnlineBadgeState(isOnline: ConversationTargetSummary['isOnline']): 'online' | 'offline' | null {
  if (typeof isOnline !== 'boolean') {
    return null;
  }
  return isOnline ? 'online' : 'offline';
}

function getTargetInitial(target: ConversationTargetSummary): string {
  const explicit = String(target.avatarFallback || '').trim();
  if (explicit) {
    return explicit.slice(0, 2).toUpperCase();
  }
  const title = String(target.title || '').trim();
  return title.charAt(0).toUpperCase() || '?';
}

function resolveBubblePalette(target: ConversationTargetSummary) {
  if (target.source === 'human') {
    return {
      accentSoft: 'rgba(251, 191, 36, 0.22)',
      border: 'rgba(251, 191, 36, 0.38)',
      bubbleSurface: 'linear-gradient(180deg, rgba(255,251,235,0.98), rgba(255,255,255,0.94))',
      text: '#92400e',
    };
  }
  if (target.source === 'agent') {
    return {
      accentSoft: 'rgba(16, 185, 129, 0.20)',
      border: 'rgba(16, 185, 129, 0.34)',
      bubbleSurface: 'linear-gradient(180deg, rgba(236,253,245,0.98), rgba(255,255,255,0.94))',
      text: '#065f46',
    };
  }
  return {
    accentSoft: 'rgba(125, 211, 252, 0.22)',
    border: 'rgba(56, 189, 248, 0.34)',
    bubbleSurface: 'linear-gradient(180deg, rgba(240,249,255,0.98), rgba(255,255,255,0.94))',
    text: '#0c4a6e',
  };
}

function buildBubbleSpaceLayout(input: {
  targets: readonly ConversationTargetSummary[];
  stageWidth: number;
}): BubbleLayoutResult {
  const targetCount = input.targets.length;
  if (targetCount === 0) {
    return { items: {}, height: 400 };
  }
  const topPadding = 48;
  const bottomPadding = 96;
  const safeWidth = Math.max(input.stageWidth, 600);
  const cloudWidth = Math.min(safeWidth * 0.62, safeWidth - 180);
  const wideCols = clamp(Math.floor(cloudWidth / CELL), 3, 7);
  const narrowCols = wideCols - 1;
  const rowHeight = Math.round(CELL * ROW_HEIGHT_FACTOR) + LABEL_HEIGHT;
  const cells: Array<{ row: number; col: number; rowCount: number }> = [];
  let cursor = 0;
  let row = 0;
  while (cursor < targetCount) {
    const maxCols = row % 2 === 0 ? narrowCols : wideCols;
    const rowCount = Math.min(maxCols, targetCount - cursor);
    for (let col = 0; col < rowCount; col += 1) {
      cells.push({ row, col, rowCount });
      cursor += 1;
    }
    row += 1;
  }
  const centerX = safeWidth / 2;
  const items: Record<string, BubbleLayout> = {};
  let maxBottom = topPadding;
  input.targets.forEach((target, index) => {
    const cell = cells[index];
    if (!cell) {
      return;
    }
    const rowMid = (cell.rowCount - 1) / 2;
    const cellX = (cell.col - rowMid) * CELL;
    const cellY = cell.row * rowHeight;
    const seed = hashSeed(target.id || `${target.title}-${index}`);
    const jx = ((seed % 9) - 4) * 1.2;
    const jy = ((Math.floor(seed / 13) % 9) - 4) * 1.2;
    const bubbleLeft = centerX + cellX - BASE_SIZE / 2 + jx;
    const bubbleTop = topPadding + cellY + jy;
    const labelTop = bubbleTop + BASE_SIZE + 8;
    items[target.id] = {
      left: bubbleLeft,
      top: bubbleTop,
      size: BASE_SIZE,
      labelTop,
      zIndex: 20 + (seed % 3),
    };
    maxBottom = Math.max(maxBottom, labelTop + LABEL_HEIGHT);
  });
  return {
    items,
    height: Math.ceil(maxBottom + bottomPadding),
  };
}

export type CanonicalTargetPaneProps = {
  targets: readonly ConversationTargetSummary[];
  loadingTargets?: boolean;
  sourceFilter: ConversationSourceFilter;
  availableSources: readonly ConversationSourceKind[];
  onSourceFilterChange?: (filter: ConversationSourceFilter) => void;
  onSelectTarget: (targetId: string | null) => void;
  renderTargetMeta?: (target: ConversationTargetSummary) => ReactNode;
};

export function CanonicalTargetPane(props: CanonicalTargetPaneProps) {
  const [transitioningTargetId, setTransitioningTargetId] = useState<string | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const transitioningIdRef = useRef<string | null>(null);
  const mousePosRafRef = useRef(0);
  const [stageWidth, setStageWidth] = useState(1280);

  useEffect(() => () => {
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    if (mousePosRafRef.current) {
      cancelAnimationFrame(mousePosRafRef.current);
    }
  }, []);

  useEffect(() => {
    const element = stageViewportRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const snap = (value: number) => Math.max(720, Math.round(value / 60) * 60);
    setStageWidth(snap(element.clientWidth));
    const observer = new ResizeObserver(() => {
      const snapped = snap(element.clientWidth);
      setStageWidth((previous) => (previous === snapped ? previous : snapped));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const bubbleLayout = useMemo(() => buildBubbleSpaceLayout({
    targets: props.targets,
    stageWidth,
  }), [props.targets, stageWidth]);
  const bubbleLayoutRef = useRef(bubbleLayout);
  bubbleLayoutRef.current = bubbleLayout;

  const applyFisheyeTransforms = useCallback(() => {
    const viewport = stageViewportRef.current;
    if (!viewport) {
      return;
    }
    const items = bubbleLayoutRef.current.items;
    const mousePos = mousePosRef.current;
    const hoveredId = hoveredIdRef.current;
    const transitioningId = transitioningIdRef.current;
    const outers = viewport.querySelectorAll<HTMLElement>('[data-bubble-id]');
    outers.forEach((outerEl) => {
      const id = outerEl.dataset.bubbleId || '';
      const innerEl = outerEl.firstElementChild as HTMLElement | null;
      if (!innerEl || !items[id]) {
        return;
      }
      const item = items[id];
      const isHovered = hoveredId === id;
      const isTransitioning = transitioningId === id;
      const isMuted = Boolean(transitioningId && !isTransitioning);
      const cx = item.left + item.size / 2;
      const cy = item.top + item.size / 2;
      let fisheyeScale: number;
      if (mousePos) {
        const dx = cx - mousePos.x;
        const dy = cy - mousePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        fisheyeScale = 1 - clamp(dist / FISHEYE_RADIUS, 0, 1) * (1 - FISHEYE_MIN_SCALE);
      } else {
        fisheyeScale = FISHEYE_IDLE_SCALE;
      }
      let tx = 0;
      let ty = 0;
      let scaleBoost = 1;
      if (hoveredId && !isHovered) {
        const hoveredLayout = items[hoveredId];
        if (hoveredLayout) {
          const dx = cx - (hoveredLayout.left + hoveredLayout.size / 2);
          const dy = cy - (hoveredLayout.top + hoveredLayout.size / 2);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < PUSH_RADIUS && dist > 0) {
            const pushFactor = 1 - dist / PUSH_RADIUS;
            const pushDistance = PUSH_STRENGTH * pushFactor * pushFactor;
            tx = (dx / dist) * pushDistance;
            ty = (dy / dist) * pushDistance;
            scaleBoost = 1 - pushFactor * 0.08;
          }
        }
      }
      const scale = isTransitioning
        ? 1.06
        : isHovered
          ? fisheyeScale * HOVER_SCALE
          : isMuted
            ? fisheyeScale * 0.92 * scaleBoost
            : fisheyeScale * scaleBoost;
      const translate = (tx !== 0 || ty !== 0) ? `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) ` : '';
      innerEl.style.transform = `${translate}scale(${scale.toFixed(3)})`;
      innerEl.style.opacity = isMuted ? '0' : '1';
      outerEl.style.zIndex = String(isHovered ? item.zIndex + 30 : isTransitioning ? item.zIndex + 20 : item.zIndex);
    });
  }, []);

  const handleStageMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (mousePosRafRef.current) {
      return;
    }
    mousePosRafRef.current = requestAnimationFrame(() => {
      mousePosRafRef.current = 0;
      const element = stageViewportRef.current;
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top + element.scrollTop;
      mousePosRef.current = { x: mx, y: my };
      const items = bubbleLayoutRef.current.items;
      const hitRadius = BASE_SIZE / 2 + 12;
      let bestId: string | null = null;
      for (const id of Object.keys(items)) {
        const item = items[id];
        if (!item) {
          continue;
        }
        const dx = mx - (item.left + item.size / 2);
        const dy = my - (item.top + item.size / 2);
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          bestId = id;
          break;
        }
      }
      hoveredIdRef.current = bestId;
      applyFisheyeTransforms();
    });
  }, [applyFisheyeTransforms]);

  const handleStageMouseLeave = useCallback(() => {
    mousePosRef.current = null;
    hoveredIdRef.current = null;
    applyFisheyeTransforms();
  }, [applyFisheyeTransforms]);

  useEffect(() => {
    transitioningIdRef.current = transitioningTargetId;
    applyFisheyeTransforms();
  }, [applyFisheyeTransforms, transitioningTargetId]);

  useEffect(() => {
    applyFisheyeTransforms();
  }, [applyFisheyeTransforms, bubbleLayout]);

  const handleSelectTarget = useCallback((targetId: string) => {
    if (!targetId || transitioningTargetId) {
      return;
    }
    setTransitioningTargetId(targetId);
    transitionTimerRef.current = setTimeout(() => {
      props.onSelectTarget(targetId);
      setTransitioningTargetId(null);
      transitionTimerRef.current = null;
    }, 220);
  }, [props.onSelectTarget, transitioningTargetId]);

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(94,234,212,0.18),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(125,211,252,0.12),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.96),_rgba(239,246,247,0.92))]" />

      <div className={cn(
        'relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-6 pt-6 transition-opacity duration-200',
        transitioningTargetId ? 'opacity-0' : 'opacity-100',
      )}>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[34px] border border-white/80 bg-white/44 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),transparent)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-[linear-gradient(0deg,rgba(255,255,255,0.42),transparent)]" />

          <div className="absolute inset-x-0 top-5 z-20 flex justify-center px-6">
            <SourceFilterPills
              activeFilter={props.sourceFilter}
              availableSources={props.availableSources}
              onChange={props.onSourceFilterChange}
            />
          </div>

          <div
            ref={stageViewportRef}
            className="h-full overflow-y-scroll overflow-x-hidden overscroll-contain px-4 py-5"
            onMouseMove={handleStageMouseMove}
            onMouseLeave={handleStageMouseLeave}
            data-canonical-target-field="bubble"
          >
            {props.loadingTargets ? (
              <div className="flex h-full min-h-[360px] items-center justify-center">
                <div className="max-w-md rounded-[28px] border border-white/85 bg-white/82 px-6 py-8 text-center shadow-[0_20px_52px_rgba(15,23,42,0.08)]">
                  <p className="text-lg font-semibold text-slate-900">Loading targets...</p>
                </div>
              </div>
            ) : null}

            {!props.loadingTargets && props.targets.length === 0 ? (
              <div className="flex h-full min-h-[360px] items-center justify-center">
                <div className="max-w-md rounded-[28px] border border-dashed border-white/85 bg-white/82 px-6 py-8 text-center shadow-[0_20px_52px_rgba(15,23,42,0.08)]">
                  <p className="text-lg font-semibold text-slate-900">No targets available</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Change the source filter or wait until a compatible conversation target appears.
                  </p>
                </div>
              </div>
            ) : null}

            {!props.loadingTargets && props.targets.length > 0 ? (
              <div className="relative min-h-[680px] w-full pt-12" style={{ height: `${bubbleLayout.height}px` }}>
                {props.targets.map((target, index) => {
                  const layout = bubbleLayout.items[target.id];
                  if (!layout) {
                    return null;
                  }
                  const palette = resolveBubblePalette(target);
                  const bubbleSeed = hashSeed(target.id || `${target.title}-${index}`);
                  const floatDuration = 5.6 + ((bubbleSeed % 4) * 0.5);
                  const floatDelay = (bubbleSeed % 7) * 160;
                  const onlineState = resolveOnlineBadgeState(target.isOnline);
                  const unreadBadge = resolveUnreadBadge(target.unreadCount);
                  const meta = props.renderTargetMeta?.(target);
                  return (
                    <div
                      key={`${target.source}:${target.id}`}
                      data-bubble-id={target.id}
                      className="absolute"
                      style={{
                        left: `${layout.left}px`,
                        top: `${layout.top}px`,
                        width: `${layout.size + 24}px`,
                        height: `${layout.size + LABEL_HEIGHT + 24}px`,
                        zIndex: layout.zIndex,
                        animation: `lc-bubble-float ${floatDuration}s ease-in-out ${floatDelay}ms infinite`,
                      }}
                    >
                      <div
                        className="h-full w-full"
                        style={{
                          transform: `scale(${FISHEYE_IDLE_SCALE})`,
                          transition: 'transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease',
                          willChange: 'transform',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectTarget(target.id)}
                          className="group relative flex items-center justify-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-emerald-200"
                          style={{
                            width: `${layout.size}px`,
                            height: `${layout.size}px`,
                          }}
                          aria-label={target.title}
                          title={typeof meta === 'string' ? meta : undefined}
                        >
                          <span
                            className="pointer-events-none absolute inset-[-10px] rounded-full opacity-70 transition-[opacity,transform] duration-200 ease-out group-hover:opacity-100 group-hover:scale-[1.05] group-focus-visible:opacity-100"
                            style={{
                              background: `radial-gradient(circle, ${palette.accentSoft} 0%, transparent 68%)`,
                            }}
                          />
                          <span
                            className={cn(
                              'pointer-events-none absolute inset-[-3px] rounded-full border transition-[opacity,transform,box-shadow] duration-200 ease-out',
                              unreadBadge ? 'animate-pulse' : '',
                            )}
                            style={{
                              borderColor: palette.border,
                              boxShadow: unreadBadge
                                ? `0 0 0 1px ${palette.border}, 0 0 20px ${palette.accentSoft}`
                                : `0 10px 20px ${palette.accentSoft}`,
                            }}
                          />
                          <span
                            className="pointer-events-none absolute inset-0 rounded-full border border-white/80 shadow-[0_8px_16px_rgba(15,23,42,0.06)]"
                            style={{ background: palette.bubbleSurface }}
                          />
                          <span className="absolute inset-[8px] overflow-hidden rounded-full border border-white/80 bg-white/90">
                            {target.avatarUrl ? (
                              <img src={target.avatarUrl} alt={target.title} className="h-full w-full object-cover" />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center text-3xl font-black" style={{ color: palette.text }}>
                                {getTargetInitial(target)}
                              </span>
                            )}
                          </span>
                          {onlineState ? (
                            <span className={cn(
                              'absolute bottom-[16%] right-[15%] h-4 w-4 rounded-full border-2 border-white',
                              onlineState === 'online' ? 'bg-emerald-500' : 'bg-slate-300',
                            )}
                            />
                          ) : null}
                          {unreadBadge ? (
                            <span className="absolute -right-2 top-2 inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-slate-900 px-2 text-[11px] font-bold text-white shadow-[0_10px_20px_rgba(15,23,42,0.2)]">
                              {unreadBadge}
                            </span>
                          ) : null}
                        </button>

                        <p
                          className="absolute left-1/2 -translate-x-1/2 truncate text-center text-xs font-semibold text-slate-700"
                          style={{
                            top: `${layout.labelTop - layout.top}px`,
                            maxWidth: `${layout.size + 22}px`,
                          }}
                        >
                          {target.title}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
