/**
 * Surface WindowManager: presents the imperative `.simulator-surface`
 * sections as draggable Aurora windows. Chrome state (ui-context) owns
 * geometry; this component writes it onto the stage elements and portals
 * one React window-chrome header per live instance into the section's
 * dedicated `.simulator-surface__chrome` host (a sibling BEFORE
 * `.simulator-surface__renderer`, allocated by the surface host).
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useUi } from './ui-context.tsx';
import type { ChromeWindowBounds, ChromeWindowGeometry } from './ui-context.tsx';
import { useShellActions } from './shell-actions.tsx';
import { AppLogo } from './app-logo.tsx';
import { FlickTracker, startFlick } from './flick.ts';
import { transitionOpenWindow, transitionWindowToRailIcon } from './window-transitions.ts';
import { depthGeometry, resolveDepthState, type DepthWindowState } from './depth-workspace.tsx';
import type { SimulatorSessionInstanceView } from '../session.ts';

export type WindowResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const WINDOW_RESIZE_EDGES: readonly WindowResizeEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const WINDOW_MIN_WIDTH = 160;
const WINDOW_MIN_HEIGHT = 120;
const WINDOW_VIEWPORT_MARGIN = 8;
const WINDOW_VIEWPORT_TOP = 48;
const WINDOW_LAYER_BASE_Z = 40;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function surfaceWindowLayerZIndex(zCounter: number): number {
  return Math.max(WINDOW_LAYER_BASE_Z, zCounter);
}

export interface SurfaceLayerProjection {
  readonly foreground: boolean;
  readonly zIndex: number;
}

export function projectSurfaceLayer(input: {
  readonly fullWindow: boolean;
  readonly surfaceLayerZ: number;
  readonly homeDepthLayerZ: number;
}): SurfaceLayerProjection {
  return {
    foreground: input.fullWindow
      || input.surfaceLayerZ > input.homeDepthLayerZ,
    zIndex: surfaceWindowLayerZIndex(input.surfaceLayerZ),
  };
}

export interface SurfaceDepthProjection {
  readonly instanceId: string;
  readonly depth: number;
  readonly state: DepthWindowState;
}

export function projectSurfaceDepths(
  instances: readonly { readonly instanceId: string }[],
  windows: Readonly<Record<string, ChromeWindowGeometry>>,
): readonly SurfaceDepthProjection[] {
  const order = new Map(instances.map((entry, index) => [entry.instanceId, index]));
  return [...instances]
    .filter((entry) => {
      const geometry = windows[entry.instanceId];
      return Boolean(geometry && !geometry.minimized);
    })
    .sort((left, right) => {
      const zDelta = windows[right.instanceId].z - windows[left.instanceId].z;
      return zDelta || (order.get(left.instanceId) ?? 0) - (order.get(right.instanceId) ?? 0);
    })
    .map((entry, depth) => ({
      instanceId: entry.instanceId,
      depth,
      state: resolveDepthState(depth),
    }));
}

export function resizeWindowBounds(
  initial: ChromeWindowBounds,
  edge: WindowResizeEdge,
  delta: { readonly x: number; readonly y: number },
  viewport: { readonly width: number; readonly height: number },
): ChromeWindowBounds {
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.w;
  let bottom = initial.y + initial.h;

  if (edge.includes('e')) {
    const minRight = left + WINDOW_MIN_WIDTH;
    right = clampNumber(
      right + delta.x,
      minRight,
      Math.max(minRight, viewport.width - WINDOW_VIEWPORT_MARGIN),
    );
  }
  if (edge.includes('w')) {
    const maxLeft = right - WINDOW_MIN_WIDTH;
    left = clampNumber(
      left + delta.x,
      Math.min(WINDOW_VIEWPORT_MARGIN, maxLeft),
      maxLeft,
    );
  }
  if (edge.includes('s')) {
    const minBottom = top + WINDOW_MIN_HEIGHT;
    bottom = clampNumber(
      bottom + delta.y,
      minBottom,
      Math.max(minBottom, viewport.height - WINDOW_VIEWPORT_MARGIN),
    );
  }
  if (edge.includes('n')) {
    const maxTop = bottom - WINDOW_MIN_HEIGHT;
    top = clampNumber(
      top + delta.y,
      Math.min(WINDOW_VIEWPORT_TOP, maxTop),
      maxTop,
    );
  }

  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}

function clampPosition(nx: number, ny: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(nx, 8), Math.max(8, window.innerWidth - 120)),
    y: Math.min(Math.max(ny, 48), Math.max(48, window.innerHeight - 96)),
  };
}

export function installWindowFocusCapture(
  stage: HTMLElement,
  instanceId: string,
  focusWindow: (instanceId: string) => void,
): () => void {
  const handlePointerDown = () => focusWindow(instanceId);
  stage.addEventListener('pointerdown', handlePointerDown, { capture: true });
  return () => stage.removeEventListener('pointerdown', handlePointerDown, { capture: true });
}

function WindowChrome({
  instance,
  label,
  depth,
}: {
  instance: SimulatorSessionInstanceView;
  label: string;
  depth: number;
}) {
  const {
    windows,
    windowNotices,
    moveWindow,
    resizeWindow,
    focusWindow,
    minimizeWindow,
    stageElement,
  } = useUi();
  const { close, navigate } = useShellActions();
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{
    edge: WindowResizeEdge;
    pointerX: number;
    pointerY: number;
    bounds: ChromeWindowBounds;
    stage: HTMLElement | null;
  } | null>(null);
  const tracker = useRef(new FlickTracker());
  const cancelFlick = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const geometry = windows[instance.instanceId];
  const notice = windowNotices[instance.moduleId] ?? null;
  const isFocus = depth === 0;

  useEffect(() => () => {
    cancelFlick.current?.();
    const stage = resize.current?.stage;
    if (stage) delete stage.dataset.resizing;
  }, []);

  if (!geometry) return null;

  const section = (el: HTMLElement | null): HTMLElement | null =>
    el?.closest<HTMLElement>('.simulator-surface') ?? null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (!isFocus) {
      focusWindow(instance.instanceId);
      return;
    }
    cancelFlick.current?.();
    drag.current = { dx: e.clientX - geometry.x, dy: e.clientY - geometry.y };
    tracker.current.reset();
    tracker.current.push(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    const stage = section(e.currentTarget as HTMLElement);
    if (stage) stage.dataset.dragging = 'true';
    focusWindow(instance.instanceId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    tracker.current.push(e.clientX, e.clientY);
    const c = clampPosition(e.clientX - drag.current.dx, e.clientY - drag.current.dy);
    moveWindow(instance.instanceId, c.x, c.y);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const stage = section(e.currentTarget as HTMLElement);
    if (drag.current) {
      const finalPos = clampPosition(e.clientX - drag.current.dx, e.clientY - drag.current.dy);
      const { vx, vy } = tracker.current.velocity();
      const flicking = Math.hypot(vx, vy) >= 80;
      cancelFlick.current = startFlick({
        vx,
        vy,
        from: finalPos,
        clamp: clampPosition,
        onMove: (nx, ny) => moveWindow(instance.instanceId, nx, ny),
        onEnd: () => {
          setDragging(false);
          if (stage) delete stage.dataset.dragging;
        },
      });
      drag.current = null;
      if (!flicking) {
        setDragging(false);
        if (stage) delete stage.dataset.dragging;
      }
    } else {
      drag.current = null;
      setDragging(false);
      if (stage) delete stage.dataset.dragging;
    }
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    tracker.current.reset();
    setDragging(false);
    const stage = section(e.currentTarget as HTMLElement);
    if (stage) delete stage.dataset.dragging;
  };

  const beginResize = (edge: WindowResizeEdge, e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !isFocus) return;
    e.preventDefault();
    e.stopPropagation();
    cancelFlick.current?.();
    cancelFlick.current = null;
    drag.current = null;
    tracker.current.reset();
    setDragging(false);
    const stage = section(e.currentTarget as HTMLElement);
    if (stage) {
      delete stage.dataset.dragging;
      stage.dataset.resizing = 'true';
    }
    resize.current = {
      edge,
      pointerX: e.clientX,
      pointerY: e.clientY,
      bounds: { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h },
      stage,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
    focusWindow(instance.instanceId);
  };

  const moveResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const active = resize.current;
    if (!active) return;
    resizeWindow(instance.instanceId, resizeWindowBounds(
      active.bounds,
      active.edge,
      { x: e.clientX - active.pointerX, y: e.clientY - active.pointerY },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  };

  const finishResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (resize.current) moveResize(e);
    const stage = resize.current?.stage;
    resize.current = null;
    setResizing(false);
    if (stage) delete stage.dataset.resizing;
  };

  const cancelResize = () => {
    const stage = resize.current?.stage;
    resize.current = null;
    setResizing(false);
    if (stage) delete stage.dataset.resizing;
  };

  const activeResize = resize.current;
  const resizeCaptureHost = activeResize?.stage?.ownerDocument.body ?? null;

  return (
    <>
      <div
        className="window-header"
        data-dragging={dragging || undefined}
        data-resizing={resizing || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <AppLogo moduleId={instance.moduleId} size="window" />
        <span className="window-title">
          {label} <em>{instance.moduleId}</em>
        </span>
        <span className="window-actions">
          <button
            type="button"
            title="最小化"
            aria-label={`最小化 ${instance.moduleId}`}
            onClick={() => transitionWindowToRailIcon(
              stageElement(instance.instanceId),
              instance.instanceId,
              instance.moduleId,
              'minimize',
              () => minimizeWindow(instance.instanceId),
            )}
          >
            —
          </button>
          <button
            type="button"
            title="放大"
            aria-label={`放大 ${instance.moduleId}`}
            onClick={() => navigate({
              kind: 'instance',
              instanceId: instance.instanceId,
              appRoute: instance.route,
            })}
          >
            □
          </button>
          <button
            type="button"
            title="关闭"
            aria-label={`关闭 ${instance.moduleId}`}
            onClick={() => transitionWindowToRailIcon(
              stageElement(instance.instanceId),
              instance.instanceId,
              instance.moduleId,
              'close',
              () => close(instance.instanceId),
            )}
          >
            ✕
          </button>
        </span>
      </div>
      {notice ? (
        <div className="window-notice" role="status">
          {notice}
        </div>
      ) : null}
      {isFocus ? WINDOW_RESIZE_EDGES.map((edge) => (
        <span
          key={edge}
          className="window-resize-handle"
          data-resize-edge={edge}
          aria-hidden="true"
          onPointerDown={(event) => beginResize(edge, event)}
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={cancelResize}
        />
      )) : null}
      {!isFocus ? (
        <button
          type="button"
          className="app-depth-switch"
          aria-label={`切换到 ${label}`}
          onClick={() => focusWindow(instance.instanceId)}
        >
          <span>切换到此应用</span>
        </button>
      ) : null}
      {resizing && activeResize && resizeCaptureHost ? createPortal(
        <span
          className="window-resize-capture"
          data-resize-edge={activeResize.edge}
          aria-hidden="true"
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={cancelResize}
        />,
        resizeCaptureHost,
        `${instance.instanceId}:resize-capture`,
      ) : null}
    </>
  );
}

export function WindowManager() {
  const { instances, route, modules } = useShellActions();
  const ui = useUi();
  const live = instances.filter((entry) => entry.status !== 'disposed');
  const liveKey = live.map((entry) => `${entry.instanceId}:${entry.moduleId}`).join(',');
  const surfaceDepths = projectSurfaceDepths(live, ui.windows);
  const surfaceDepthById = new Map(surfaceDepths.map((entry) => [entry.instanceId, entry]));

  // Scenario and reset instances are background-running Apps: syncing their
  // geometry keeps every window closed by default. Only an explicit Shell
  // present/restore action or a full-window deep link may expose one.
  useEffect(() => {
    ui.syncWindows(live.map((entry) => ({ instanceId: entry.instanceId, moduleId: entry.moduleId })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  // App renderers may stop pointer events inside their own React trees. Focus
  // therefore belongs to the shell-owned stage capture phase rather than the
  // bubbling `onpointerdown` property.
  useEffect(() => {
    const removeListeners: Array<() => void> = [];
    for (const entry of live) {
      const stage = ui.stageElement(entry.instanceId);
      if (!stage) continue;
      removeListeners.push(installWindowFocusCapture(
        stage,
        entry.instanceId,
        ui.focusWindow,
      ));
    }
    return () => {
      for (const removeListener of removeListeners) removeListener();
    };
  });

  // Project chrome geometry onto the imperative stage elements. Runs after
  // every commit; each write is idempotent. In full-window mode the surface
  // host's setFullWindow owns hidden state and the full-window CSS owns
  // layout; stale inline window geometry is stripped so the section carries
  // no inline left/top/width/height/zIndex (it is re-applied on exit).
  const knownWindowIds = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const fullWindow = route.kind === 'instance';
    const hideForDiagnostics = route.kind === 'diagnostics';
    const surfaceLayerProjection = projectSurfaceLayer({
      fullWindow,
      surfaceLayerZ: ui.surfaceLayerZ,
      homeDepthLayerZ: ui.homeDepthLayerZ,
    });
    const surfaceForeground = surfaceLayerProjection.foreground;
    const surfaceLayer = live
      .map((entry) => ui.stageElement(entry.instanceId)?.parentElement ?? null)
      .find((element): element is HTMLElement => element?.id === 'simulator-surfaces');
    if (surfaceLayer) {
      surfaceLayer.style.zIndex = String(surfaceLayerProjection.zIndex);
      surfaceLayer.dataset.shellForeground = String(surfaceForeground);
      surfaceLayer.inert = !surfaceForeground;
      if (surfaceForeground) surfaceLayer.removeAttribute('aria-hidden');
      else surfaceLayer.setAttribute('aria-hidden', 'true');
    }
    const previousIds = knownWindowIds.current;
    const nextIds = new Set(live.map((entry) => entry.instanceId));
    knownWindowIds.current = nextIds;
    const opened = previousIds === null
      ? []
      : live.filter((entry) => !previousIds.has(entry.instanceId));
    const focusProjection = surfaceDepths[0] ?? null;
    const focusGeometry = focusProjection ? ui.windows[focusProjection.instanceId] : null;
    for (const entry of live) {
      const stage = ui.stageElement(entry.instanceId);
      if (!stage) continue;
      stage.dataset.instanceStatus = entry.status;
      stage.dataset.readinessStatus = entry.readiness;
      const geometry = ui.windows[entry.instanceId];
      if (!geometry) continue;
      const appRoots = [
        stage.querySelector<HTMLElement>('.simulator-surface__renderer'),
        stage.querySelector<HTMLElement>('.simulator-surface__overlays'),
      ].filter((root): root is HTMLElement => root !== null);
      if (fullWindow) {
        stage.style.left = '';
        stage.style.top = '';
        stage.style.width = '';
        stage.style.height = '';
        stage.style.zIndex = '';
        delete stage.dataset.appDepth;
        delete stage.dataset.appDepthState;
        stage.style.removeProperty('--surface-depth-x');
        stage.style.removeProperty('--surface-depth-y');
        stage.style.removeProperty('--surface-depth-z');
        stage.style.removeProperty('--surface-depth-scale');
        stage.style.removeProperty('--surface-depth-opacity');
        stage.style.removeProperty('--surface-depth-blur');
        stage.style.removeProperty('--surface-depth-rotate-x');
        stage.style.removeProperty('--surface-depth-rotate-y');
        stage.removeAttribute('aria-hidden');
        for (const root of appRoots) {
          root.inert = false;
          root.removeAttribute('aria-hidden');
        }
        continue;
      }
      const projection = surfaceDepthById.get(entry.instanceId) ?? null;
      const anchor = projection && focusGeometry ? focusGeometry : geometry;
      const depth = projection?.depth ?? 0;
      const depthStyle = depthGeometry(depth);
      stage.style.left = `${anchor.x}px`;
      stage.style.top = `${anchor.y}px`;
      stage.style.width = `${anchor.w}px`;
      stage.style.height = `${anchor.h}px`;
      stage.style.zIndex = String(geometry.z);
      stage.hidden = geometry.minimized || hideForDiagnostics;
      stage.dataset.top = projection?.depth === 0 ? 'true' : 'false';
      stage.dataset.appDepth = String(depth);
      stage.dataset.appDepthState = projection?.state ?? 'hidden';
      if (projection?.state === 'hidden') stage.setAttribute('aria-hidden', 'true');
      else stage.removeAttribute('aria-hidden');
      const appContentInert = !surfaceForeground
        || geometry.minimized
        || Boolean(projection && projection.depth > 0);
      for (const root of appRoots) {
        root.inert = appContentInert;
        if (appContentInert) root.setAttribute('aria-hidden', 'true');
        else root.removeAttribute('aria-hidden');
      }
      stage.style.setProperty('--surface-depth-x', `${depthStyle.x}px`);
      stage.style.setProperty('--surface-depth-y', `${depthStyle.y}px`);
      stage.style.setProperty('--surface-depth-z', `${depthStyle.z}px`);
      stage.style.setProperty('--surface-depth-scale', String(depthStyle.scale));
      stage.style.setProperty('--surface-depth-opacity', String(depthStyle.opacity));
      stage.style.setProperty('--surface-depth-blur', `${depthStyle.blur}px`);
      stage.style.setProperty('--surface-depth-rotate-x', `${depthStyle.rotateX}deg`);
      stage.style.setProperty('--surface-depth-rotate-y', `${depthStyle.rotateY}deg`);
    }
    // macOS-style launch: windows that appear after the initial batch zoom
    // out of their app-rail icon.
    if (!fullWindow && !hideForDiagnostics) {
      for (const entry of opened) {
        transitionOpenWindow(ui.stageElement(entry.instanceId), entry.instanceId, entry.moduleId);
      }
    }
  });

  const surfaceLabel = (entry: SimulatorSessionInstanceView): string =>
    modules.find((module) => module.moduleId === entry.moduleId)
      ?.surfaces.find((surface) => surface.id === entry.surfaceId)?.label ?? entry.surfaceId;

  return (
    <>
      {live.map((entry) => {
        const stage = ui.stageElement(entry.instanceId);
        const chromeHost = stage?.querySelector('.simulator-surface__chrome') ?? null;
        if (!chromeHost) return null;
        return createPortal(
          <WindowChrome
            instance={entry}
            label={surfaceLabel(entry)}
            depth={surfaceDepthById.get(entry.instanceId)?.depth ?? Number.POSITIVE_INFINITY}
          />,
          chromeHost,
          `${entry.instanceId}:chrome`,
        );
      })}
    </>
  );
}
