import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { SPAWN_SIZE, useSim, type SimWindow } from '../engine/SimContext';
import { MODULES } from '../scenario/meta';
import { FlickTracker, startFlick } from './flick';
import { DesktopMain } from '../modules/DesktopMain';
import { ZhiyuMain } from '../modules/ZhiyuMain';
import { TesterMain } from '../modules/TesterMain';

const SURFACES: Record<SimWindow['moduleId'], (win: SimWindow) => ReactNode> = {
  desktop: (win) => <DesktopMain win={win} />,
  zhiyu: (win) => <ZhiyuMain win={win} />,
  tester: (win) => <TesterMain win={win} />,
};

function WindowFrame({ win }: { win: SimWindow }) {
  const { state, focusWindow, minimizeWindow, closeWindow, moveWindow } = useSim();
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const tracker = useRef(new FlickTracker());
  const cancelFlick = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => cancelFlick.current?.(), []);
  const meta = MODULES[win.moduleId];
  const size = SPAWN_SIZE[win.moduleId];
  const topZ = Math.max(0, ...state.windows.map((w) => w.z));

  const clamp = (nx: number, ny: number) => ({
    x: Math.min(Math.max(nx, 8), window.innerWidth - 240),
    y: Math.min(Math.max(ny, 60), window.innerHeight - 96),
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    cancelFlick.current?.();
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    tracker.current.reset();
    tracker.current.push(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    focusWindow(win.instanceId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    tracker.current.push(e.clientX, e.clientY);
    const c = clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy);
    moveWindow(win.instanceId, c.x, c.y);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      const finalPos = clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy);
      const { vx, vy } = tracker.current.velocity();
      const flicking = Math.hypot(vx, vy) >= 80;
      cancelFlick.current = startFlick({
        vx,
        vy,
        from: finalPos,
        clamp,
        onMove: (nx, ny) => moveWindow(win.instanceId, nx, ny),
        onEnd: () => setDragging(false),
      });
      drag.current = null;
      if (!flicking) setDragging(false);
    } else {
      drag.current = null;
      setDragging(false);
    }
  };

  return (
    <section
      className="window-frame nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-regular"
      data-nimi-tone="panel"
      data-instance-module={win.moduleId}
      data-top={win.z === topZ || undefined}
      data-dragging={dragging || undefined}
      style={{ left: win.x, top: win.y, width: size.w, height: size.h, zIndex: win.z }}
      onPointerDown={() => focusWindow(win.instanceId)}
      aria-label={meta.name}
    >
      <div
        className="window-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="module-accent" style={{ background: meta.accent }} />
        <span className="window-title">
          {meta.name} <em>{meta.tag}</em>
        </span>
        <span className="t-mono window-iid">{win.instanceId}</span>
        <span className="window-actions">
          <button type="button" title="最小化" onClick={() => minimizeWindow(win.instanceId)}>
            —
          </button>
          <button type="button" title="关闭" onClick={() => closeWindow(win.instanceId)}>
            ✕
          </button>
        </span>
      </div>
      {win.notice ? (
        <div className="window-notice" role="status">
          {win.notice}
        </div>
      ) : null}
      <div className={`window-body nimi-ui-module--${win.moduleId}`}>{SURFACES[win.moduleId](win)}</div>
    </section>
  );
}

export function WindowManager() {
  const { state } = useSim();
  return (
    <>
      {state.windows
        .filter((w) => !w.minimized)
        .map((w) => (
          <WindowFrame key={w.instanceId} win={w} />
        ))}
    </>
  );
}
