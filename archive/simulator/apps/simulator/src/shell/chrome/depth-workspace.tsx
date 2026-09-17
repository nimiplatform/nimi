import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  NIMI_MOTION_DURATIONS_MS,
  motion,
  useNimiReducedMotion,
} from '@nimiplatform/kit/ui/motion';
import { useUi } from './ui-context.tsx';

export type DepthWindowState = 'focus' | 'depth-1' | 'depth-2' | 'depth-3' | 'hidden';
export type DepthWindowResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface DepthWindowDefinition {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly icon?: ReactNode;
  readonly className?: string;
  readonly actions?: ReactNode;
  readonly hideHeader?: boolean;
  readonly content: ReactNode;
}

export interface DepthGeometry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly opacity: number;
  readonly blur: number;
  readonly rotateY: number;
  readonly rotateX: number;
}

export interface DepthWindowPosition {
  readonly x: number;
  readonly y: number;
}

export interface DepthWindowSize {
  readonly width: number;
  readonly height: number;
}

interface DepthWindowRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface DepthViewport {
  readonly width: number;
  readonly height: number;
}

export const DEPTH_GEOMETRY: readonly DepthGeometry[] = [
  { x: 0, y: 0, z: 0, scale: 1, opacity: 1, blur: 0, rotateY: 0, rotateX: 0 },
  { x: 300, y: -55, z: -180, scale: 0.82, opacity: 0.72, blur: 1.5, rotateY: -5, rotateX: 1 },
  { x: 620, y: -105, z: -360, scale: 0.66, opacity: 0.45, blur: 3, rotateY: -7, rotateX: 1 },
  { x: 800, y: -142, z: -510, scale: 0.54, opacity: 0.28, blur: 4.5, rotateY: -8, rotateX: 1 },
] as const;

export function depthGeometry(depth: number): DepthGeometry {
  const normalizedDepth = Math.max(0, Math.min(depth, DEPTH_GEOMETRY.length - 1));
  return DEPTH_GEOMETRY[normalizedDepth];
}

const DEFAULT_WINDOW_POSITION: DepthWindowPosition = { x: 0, y: 0 };
const WINDOW_VIEWPORT_MARGIN_PX = 8;
const WINDOW_VIEWPORT_TOP_PX = 48;
const WINDOW_HEADER_HEIGHT_PX = 54;
const WINDOW_MIN_VISIBLE_WIDTH_PX = 180;
const WINDOW_MIN_WIDTH_PX = 280;
const WINDOW_MIN_HEIGHT_PX = 200;
const WHEEL_COMMIT_DELTA = 38;
const WHEEL_THROTTLE_MS = 680;
const DEPTH_WINDOW_RESIZE_EDGES: readonly DepthWindowResizeEdge[] = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
];

export function resolveDepth(
  index: number,
  activeIndex: number,
  windowCount: number,
): number {
  if (windowCount <= 0) return Number.POSITIVE_INFINITY;
  return (index - activeIndex + windowCount) % windowCount;
}

export function resolveDepthState(depth: number): DepthWindowState {
  if (depth === 0) return 'focus';
  if (depth === 1) return 'depth-1';
  if (depth === 2) return 'depth-2';
  if (depth === 3) return 'depth-3';
  return 'hidden';
}

export function clampDepthWindowPosition(
  origin: DepthWindowPosition,
  delta: DepthWindowPosition,
  rect: DepthWindowRect,
  viewport: DepthViewport,
): DepthWindowPosition {
  const availableWidth = Math.max(0, viewport.width - WINDOW_VIEWPORT_MARGIN_PX * 2);
  const visibleWidth = Math.min(WINDOW_MIN_VISIBLE_WIDTH_PX, rect.width, availableWidth);
  const minLeft = WINDOW_VIEWPORT_MARGIN_PX + visibleWidth - rect.width;
  const maxLeft = Math.max(minLeft, viewport.width - WINDOW_VIEWPORT_MARGIN_PX - visibleWidth);
  const availableHeight = Math.max(0, viewport.height - WINDOW_VIEWPORT_TOP_PX - WINDOW_VIEWPORT_MARGIN_PX);
  const visibleHeaderHeight = Math.min(WINDOW_HEADER_HEIGHT_PX, rect.height, availableHeight);
  const minTop = Math.min(WINDOW_VIEWPORT_TOP_PX, viewport.height - visibleHeaderHeight);
  const maxTop = Math.max(minTop, viewport.height - WINDOW_VIEWPORT_MARGIN_PX - visibleHeaderHeight);
  const left = Math.min(Math.max(rect.left + delta.x, minLeft), maxLeft);
  const top = Math.min(Math.max(rect.top + delta.y, minTop), maxTop);

  return {
    x: origin.x + left - rect.left,
    y: origin.y + top - rect.top,
  };
}

export function resizeDepthWindowBounds(
  initial: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  edge: DepthWindowResizeEdge,
  delta: DepthWindowPosition,
  viewport: DepthViewport,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const minWidth = Math.min(
    WINDOW_MIN_WIDTH_PX,
    Math.max(1, viewport.width - WINDOW_VIEWPORT_MARGIN_PX * 2),
  );
  const minHeight = Math.min(
    WINDOW_MIN_HEIGHT_PX,
    Math.max(1, viewport.height - WINDOW_VIEWPORT_TOP_PX - WINDOW_VIEWPORT_MARGIN_PX),
  );
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.w;
  let bottom = initial.y + initial.h;

  if (edge.includes('e')) {
    right = Math.min(
      Math.max(right + delta.x, left + minWidth),
      Math.max(left + minWidth, viewport.width - WINDOW_VIEWPORT_MARGIN_PX),
    );
  }
  if (edge.includes('w')) {
    left = Math.max(
      Math.min(left + delta.x, right - minWidth),
      Math.min(WINDOW_VIEWPORT_MARGIN_PX, right - minWidth),
    );
  }
  if (edge.includes('s')) {
    bottom = Math.min(
      Math.max(bottom + delta.y, top + minHeight),
      Math.max(top + minHeight, viewport.height - WINDOW_VIEWPORT_MARGIN_PX),
    );
  }
  if (edge.includes('n')) {
    top = Math.max(
      Math.min(top + delta.y, bottom - minHeight),
      Math.min(WINDOW_VIEWPORT_TOP_PX, bottom - minHeight),
    );
  }

  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}

function canScrollVertically(target: EventTarget | null, boundary: HTMLElement, deltaY: number): boolean {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== boundary) {
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    if (maxScrollTop > 1) {
      if (deltaY > 0 && element.scrollTop < maxScrollTop - 1) return true;
      if (deltaY < 0 && element.scrollTop > 1) return true;
    }
    element = element.parentElement;
  }
  return false;
}

interface UseDepthNavigationOptions {
  readonly ids: readonly string[];
  readonly activeId: string;
  readonly onActiveChange: (id: string) => void;
}

export function useDepthNavigation({
  ids,
  activeId,
  onActiveChange,
}: UseDepthNavigationOptions) {
  const activeIndex = Math.max(0, ids.indexOf(activeId));
  const [positions, setPositions] = useState<Readonly<Record<string, DepthWindowPosition>>>({});
  const [sizes, setSizes] = useState<Readonly<Record<string, DepthWindowSize>>>({});
  const [isDragging, setDragging] = useState(false);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizingEdge, setResizingEdge] = useState<DepthWindowResizeEdge | null>(null);
  const [isTransitioning, setTransitioning] = useState(false);
  const previousActive = useRef(activeId);
  const drag = useRef<{
    readonly pointerId: number;
    readonly windowId: string;
    readonly startX: number;
    readonly startY: number;
    readonly origin: DepthWindowPosition;
    readonly rect: DepthWindowRect;
  } | null>(null);
  const resize = useRef<{
    readonly pointerId: number;
    readonly windowId: string;
    readonly edge: DepthWindowResizeEdge;
    readonly startX: number;
    readonly startY: number;
    readonly originPosition: DepthWindowPosition;
    readonly rect: DepthWindowRect;
  } | null>(null);
  const wheel = useRef({ accumulated: 0, lastEvent: 0, lastCommit: Number.NEGATIVE_INFINITY });

  useEffect(() => {
    if (previousActive.current === activeId) return undefined;
    previousActive.current = activeId;
    setTransitioning(true);
    const timer = window.setTimeout(
      () => setTransitioning(false),
      NIMI_MOTION_DURATIONS_MS.ambient,
    );
    return () => window.clearTimeout(timer);
  }, [activeId]);

  const activate = useCallback((id: string) => {
    if (!ids.includes(id) || id === activeId || isTransitioning) return;
    setTransitioning(true);
    onActiveChange(id);
  }, [activeId, ids, isTransitioning, onActiveChange]);

  const move = useCallback((direction: -1 | 1) => {
    if (ids.length < 2 || isTransitioning) return;
    const nextIndex = (activeIndex + direction + ids.length) % ids.length;
    activate(ids[nextIndex]);
  }, [activate, activeIndex, ids, isTransitioning]);

  const onWheel = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    if (isTransitioning || canScrollVertically(event.target, event.currentTarget, event.deltaY)) return;
    const timestamp = event.timeStamp;
    if (timestamp - wheel.current.lastEvent > 180) wheel.current.accumulated = 0;
    wheel.current.lastEvent = timestamp;
    wheel.current.accumulated += event.deltaY;
    if (
      Math.abs(wheel.current.accumulated) < WHEEL_COMMIT_DELTA
      || timestamp - wheel.current.lastCommit < WHEEL_THROTTLE_MS
    ) return;
    event.preventDefault();
    const direction = wheel.current.accumulated > 0 ? 1 : -1;
    wheel.current.accumulated = 0;
    wheel.current.lastCommit = timestamp;
    move(direction);
  }, [isTransitioning, move]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.button !== 0
      || isTransitioning
      || resize.current !== null
      || (event.target as HTMLElement).closest('button,a,input,select,textarea')
    ) return;
    const windowElement = event.currentTarget.closest<HTMLElement>('.depth-window');
    if (!windowElement) return;
    const rect = windowElement.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      windowId: activeId,
      startX: event.clientX,
      startY: event.clientY,
      origin: positions[activeId] ?? DEFAULT_WINDOW_POSITION,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, [activeId, isTransitioning, positions]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = clampDepthWindowPosition(
      current.origin,
      {
        x: event.clientX - current.startX,
        y: event.clientY - current.startY,
      },
      current.rect,
      {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    );
    setPositions((previous) => ({
      ...previous,
      [current.windowId]: next,
    }));
  }, []);

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const cancelDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const updateResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = resizeDepthWindowBounds(
      {
        x: current.rect.left,
        y: current.rect.top,
        w: current.rect.width,
        h: current.rect.height,
      },
      current.edge,
      {
        x: event.clientX - current.startX,
        y: event.clientY - current.startY,
      },
      {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    );
    setPositions((previous) => ({
      ...previous,
      [current.windowId]: {
        x: current.originPosition.x + next.x - current.rect.left,
        // Focused windows are bottom-anchored in CSS. Compensate for height
        // changes so south-edge resize keeps the top fixed and north-edge
        // resize follows the pointer.
        y: current.originPosition.y
          + next.y - current.rect.top
          + next.h - current.rect.height,
      },
    }));
    setSizes((previous) => ({
      ...previous,
      [current.windowId]: { width: next.w, height: next.h },
    }));
  }, []);

  const beginResize = useCallback((
    windowId: string,
    edge: DepthWindowResizeEdge,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.button !== 0 || isTransitioning || windowId !== activeId) return;
    const windowElement = event.currentTarget.closest<HTMLElement>('.depth-window');
    if (!windowElement) return;
    const rect = windowElement.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    drag.current = null;
    setDragging(false);
    resize.current = {
      pointerId: event.pointerId,
      windowId,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      originPosition: positions[windowId] ?? DEFAULT_WINDOW_POSITION,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingId(windowId);
    setResizingEdge(edge);
  }, [activeId, isTransitioning, positions]);

  const finishResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    updateResize(event);
    resize.current = null;
    setResizingId(null);
    setResizingEdge(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [updateResize]);

  const cancelResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resize.current = null;
    setResizingId(null);
    setResizingEdge(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return {
    activeIndex,
    activate,
    positions,
    sizes,
    isDragging,
    resizingId,
    resizingEdge,
    isTransitioning,
    onWheel,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: cancelDrag,
    },
    resizeHandleProps: (windowId: string, edge: DepthWindowResizeEdge) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => beginResize(windowId, edge, event),
      onPointerMove: updateResize,
      onPointerUp: finishResize,
      onPointerCancel: cancelResize,
    }),
    resizeCaptureProps: {
      onPointerMove: updateResize,
      onPointerUp: finishResize,
      onPointerCancel: cancelResize,
    },
  } as const;
}

export function WindowContent({ children }: { readonly children: ReactNode }) {
  return <div className="depth-window__content">{children}</div>;
}

interface DepthWindowProps {
  readonly definition: DepthWindowDefinition;
  readonly depth: number;
  readonly position: DepthWindowPosition;
  readonly size?: DepthWindowSize;
  readonly isDragging: boolean;
  readonly isResizing: boolean;
  readonly isTransitioning: boolean;
  readonly onRaise: (id: string) => void;
  readonly onActivate: (id: string) => void;
  readonly dragHandleProps: ReturnType<typeof useDepthNavigation>['dragHandleProps'];
  readonly resizeHandleProps: ReturnType<typeof useDepthNavigation>['resizeHandleProps'];
}

export function DepthWindow({
  definition,
  depth,
  position,
  size,
  isDragging,
  isResizing,
  isTransitioning,
  onRaise,
  onActivate,
  dragHandleProps,
  resizeHandleProps,
}: DepthWindowProps) {
  const reducedMotion = useNimiReducedMotion();
  const state = resolveDepthState(depth);
  const geometry = depthGeometry(depth);
  const isFocus = state === 'focus';
  const isHidden = state === 'hidden';
  const x = geometry.x + (isFocus ? position.x : 0);
  const y = geometry.y + (isFocus ? position.y : 0);
  const transition = isDragging && isFocus
    ? { duration: 0 }
    : reducedMotion
      ? {
          x: { duration: 0 },
          y: { duration: 0 },
          z: { duration: 0 },
          scale: { duration: 0 },
          rotateX: { duration: 0 },
          rotateY: { duration: 0 },
          opacity: { duration: NIMI_MOTION_DURATIONS_MS.base / 1000 },
        }
      : {
          duration: NIMI_MOTION_DURATIONS_MS.ambient / 1000,
          ease: [0.05, 0.7, 0.1, 1] as const,
        };

  return (
    <motion.section
      className={`depth-window pane ${definition.className ?? ''}`}
      data-depth-state={state}
      data-depth={isHidden ? undefined : depth}
      data-interactive={isFocus && !isTransitioning}
      data-dragging={isFocus && isDragging || undefined}
      data-resizing={isFocus && isResizing || undefined}
      data-resized={isFocus && size ? true : undefined}
      data-nimi-material="glass-regular"
      data-nimi-tone="panel"
      aria-label={definition.title}
      aria-current={isFocus ? 'page' : undefined}
      aria-hidden={isHidden || undefined}
      onPointerDownCapture={isFocus ? () => onRaise(definition.id) : undefined}
      animate={{
        x,
        y,
        z: geometry.z,
        scale: geometry.scale,
        opacity: geometry.opacity,
        rotateY: geometry.rotateY,
        rotateX: geometry.rotateX,
      }}
      whileHover={!isFocus && !isHidden && !isTransitioning ? {
        x: geometry.x - 18,
        z: geometry.z + 34,
        opacity: Math.min(0.86, geometry.opacity + 0.14),
      } : undefined}
      transition={transition}
      style={{
        zIndex: 40 - Math.min(depth, 39),
        width: isFocus && size ? `${size.width}px` : undefined,
        height: isFocus && size ? `${size.height}px` : undefined,
        maxHeight: isFocus && size ? 'none' : undefined,
        '--depth-blur': `${geometry.blur}px`,
        '--depth-content-opacity': isFocus ? 1 : Math.max(0.48, geometry.opacity),
      } as CSSProperties}
    >
      {definition.hideHeader ? null : (
        <header
          className="depth-window__header"
          data-drag-axis={isFocus ? 'both' : undefined}
          title={isFocus ? `拖动${definition.title}窗口` : undefined}
          {...(isFocus && !isTransitioning ? dragHandleProps : {})}
        >
          <span className="depth-window__identity">
            {definition.icon ? (
              <span className="depth-window__icon" aria-hidden>{definition.icon}</span>
            ) : null}
            <span className="depth-window__title">{definition.title}</span>
          </span>
          <span className="depth-window__header-side">
            {definition.status ? (
              <span className="depth-window__status">
                <span className="depth-window__status-dot" aria-hidden />
                {definition.status}
              </span>
            ) : null}
            <span className="depth-window__chrome-actions">{definition.actions}</span>
            {isFocus ? <span className="depth-window__drag-hint" aria-hidden>✥</span> : null}
          </span>
        </header>
      )}
      <WindowContent>{definition.content}</WindowContent>
      {isFocus ? DEPTH_WINDOW_RESIZE_EDGES.map((edge) => (
        <span
          key={edge}
          className="window-resize-handle depth-window__resize-handle"
          data-resize-edge={edge}
          aria-hidden="true"
          {...resizeHandleProps(definition.id, edge)}
        />
      )) : null}
      {!isFocus && !isHidden ? (
        <button
          type="button"
          className="depth-window__switch"
          aria-label={`切换到${definition.title}`}
          onClick={() => onActivate(definition.id)}
        >
          <span className="depth-window__switch-label">切换到此页面</span>
        </button>
      ) : null}
    </motion.section>
  );
}

interface DepthWorkspaceProps {
  readonly windows: readonly DepthWindowDefinition[];
  readonly activeId: string;
  readonly onActiveChange: (id: string) => void;
}

interface TiledWorkspaceProps {
  readonly windows: readonly DepthWindowDefinition[];
  readonly activeId: string;
  readonly onActiveChange: (id: string) => void;
}

/**
 * Home panels belong to the desktop itself: all three stay visible and
 * interactive instead of competing for the one foreground depth slot.
 */
export function TiledWorkspace({
  windows,
  activeId,
  onActiveChange,
}: TiledWorkspaceProps) {
  const { homeDepthLayerZ, surfaceLayerZ } = useUi();
  const isForeground = homeDepthLayerZ > surfaceLayerZ;
  const workspace = (
    <section
      className="desktop-tile-workspace"
      aria-label="桌面平铺工作区"
      aria-hidden={!isForeground}
      data-active-window={activeId}
      data-shell-foreground={isForeground}
      inert={!isForeground}
      style={{ zIndex: homeDepthLayerZ }}
    >
      <div className="desktop-tile-workspace__grid">
        {windows.map((definition) => (
          <section
            key={definition.id}
            className={`depth-window desktop-tile-window pane ${definition.className ?? ''}`}
            data-depth-state="focus"
            data-interactive="true"
            data-tile-window={definition.id}
            data-active={definition.id === activeId || undefined}
            data-header-hidden={definition.hideHeader || undefined}
            data-nimi-material="glass-regular"
            data-nimi-tone="panel"
            aria-label={definition.title}
            onPointerDownCapture={() => onActiveChange(definition.id)}
          >
            {definition.hideHeader ? null : (
              <header className="depth-window__header">
                <span className="depth-window__identity">
                  {definition.icon ? (
                    <span className="depth-window__icon" aria-hidden>{definition.icon}</span>
                  ) : null}
                  <span className="depth-window__title">{definition.title}</span>
                </span>
                <span className="depth-window__header-side">
                  {definition.status ? (
                    <span className="depth-window__status">
                      <span className="depth-window__status-dot" aria-hidden />
                      {definition.status}
                    </span>
                  ) : null}
                  <span className="depth-window__chrome-actions">{definition.actions}</span>
                </span>
              </header>
            )}
            <WindowContent>{definition.content}</WindowContent>
          </section>
        ))}
      </div>
    </section>
  );

  return typeof document === 'undefined'
    ? workspace
    : createPortal(workspace, document.body, 'simulator-home-tile-workspace');
}

export function DepthWorkspace({
  windows,
  activeId,
  onActiveChange,
}: DepthWorkspaceProps) {
  const { homeDepthLayerZ } = useUi();
  const ids = useMemo(() => windows.map((window) => window.id), [windows]);
  const navigation = useDepthNavigation({ ids, activeId, onActiveChange });

  const workspace = (
    <section
      className="depth-workspace"
      aria-label="景深工作区"
      data-active-window={activeId}
      data-transitioning={navigation.isTransitioning || undefined}
      onWheel={navigation.onWheel}
      style={{
        zIndex: homeDepthLayerZ,
        '--depth-active-index': navigation.activeIndex,
      } as CSSProperties}
    >
      <span className="depth-workspace__parallax" aria-hidden />
      <div className="depth-workspace__scene">
        {windows.map((definition, index) => {
          const depth = resolveDepth(index, navigation.activeIndex, windows.length);
          return (
            <DepthWindow
              key={definition.id}
              definition={definition}
              depth={depth}
              position={navigation.positions[definition.id] ?? DEFAULT_WINDOW_POSITION}
              size={navigation.sizes[definition.id]}
              isDragging={navigation.isDragging}
              isResizing={navigation.resizingId === definition.id}
              isTransitioning={navigation.isTransitioning}
              onRaise={onActiveChange}
              onActivate={navigation.activate}
              dragHandleProps={navigation.dragHandleProps}
              resizeHandleProps={navigation.resizeHandleProps}
            />
          );
        })}
      </div>
      {navigation.resizingEdge ? (
        <span
          className="window-resize-capture depth-window__resize-capture"
          data-resize-edge={navigation.resizingEdge}
          aria-hidden="true"
          {...navigation.resizeCaptureProps}
        />
      ) : null}
    </section>
  );

  return typeof document === 'undefined'
    ? workspace
    : createPortal(workspace, document.body, 'simulator-home-depth-workspace');
}
