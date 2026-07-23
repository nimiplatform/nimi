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
import { moduleAccent, useShellActions } from './shell-actions.tsx';
import { FlickTracker, startFlick } from './flick.ts';
import type { SimulatorSessionInstanceView } from '../session.ts';

function clampPosition(nx: number, ny: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(nx, 8), Math.max(8, window.innerWidth - 120)),
    y: Math.min(Math.max(ny, 48), Math.max(48, window.innerHeight - 96)),
  };
}

function WindowChrome({ instance, label }: { instance: SimulatorSessionInstanceView; label: string }) {
  const { windows, windowNotices, moveWindow, focusWindow, minimizeWindow } = useUi();
  const { close } = useShellActions();
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const tracker = useRef(new FlickTracker());
  const cancelFlick = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  const geometry = windows[instance.instanceId];
  const notice = windowNotices[instance.moduleId] ?? null;

  useEffect(() => () => cancelFlick.current?.(), []);

  if (!geometry) return null;

  const section = (el: HTMLElement | null): HTMLElement | null =>
    el?.closest<HTMLElement>('.simulator-surface') ?? null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
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

  return (
    <>
      <div
        className="window-header"
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <span className="module-accent" style={{ background: moduleAccent(instance.moduleId) }} />
        <span className="window-title">
          {label} <em>{instance.moduleId}</em>
        </span>
        <span className="t-mono window-iid">{instance.instanceId}</span>
        <span className="window-actions">
          <button
            type="button"
            title="最小化"
            aria-label={`最小化 ${instance.moduleId}`}
            onClick={() => minimizeWindow(instance.instanceId)}
          >
            —
          </button>
          <button
            type="button"
            title="关闭"
            aria-label={`关闭 ${instance.moduleId}`}
            onClick={() => close(instance.instanceId)}
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
    </>
  );
}

export function WindowManager() {
  const { instances, route, modules } = useShellActions();
  const ui = useUi();
  const live = instances.filter((entry) => entry.status !== 'disposed');
  const liveKey = live.map((entry) => `${entry.instanceId}:${entry.moduleId}`).join(',');

  // Initialize geometry for newly-appeared instances (cascade slots) and
  // garbage-collect geometry for disposed ones.
  useEffect(() => {
    ui.syncWindows(live.map((entry) => ({ instanceId: entry.instanceId, moduleId: entry.moduleId })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  // Project chrome geometry onto the imperative stage elements. Runs after
  // every commit; each write is idempotent. In full-window mode the surface
  // host's setFullWindow owns hidden state and the full-window CSS owns
  // layout; stale inline window geometry is stripped so the section carries
  // no inline left/top/width/height/zIndex (it is re-applied on exit).
  useEffect(() => {
    const fullWindow = route.kind === 'instance';
    const hideForDiagnostics = route.kind === 'diagnostics';
    for (const entry of live) {
      const stage = ui.stageElement(entry.instanceId);
      if (!stage) continue;
      const geometry = ui.windows[entry.instanceId];
      if (!geometry) continue;
      stage.onpointerdown = () => ui.focusWindow(entry.instanceId);
      if (fullWindow) {
        stage.style.left = '';
        stage.style.top = '';
        stage.style.width = '';
        stage.style.height = '';
        stage.style.zIndex = '';
        continue;
      }
      stage.style.left = `${geometry.x}px`;
      stage.style.top = `${geometry.y}px`;
      stage.style.width = `${geometry.w}px`;
      stage.style.height = `${geometry.h}px`;
      stage.style.zIndex = String(geometry.z);
      stage.hidden = geometry.minimized || hideForDiagnostics;
      stage.dataset.top = geometry.z === ui.zCounter ? 'true' : 'false';
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
          <WindowChrome instance={entry} label={surfaceLabel(entry)} />,
          chromeHost,
          `${entry.instanceId}:chrome`,
        );
      })}
    </>
  );
}
