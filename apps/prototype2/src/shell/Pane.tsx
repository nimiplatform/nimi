import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { FlickTracker, startFlick } from './flick';

interface PaneProps {
  id: string;
  title?: string;
  sub?: string;
  x: number;
  y: number;
  w?: number;
  z: number;
  agent?: boolean;
  woven?: boolean;
  weaveHint?: boolean;
  top?: boolean;
  driftDelay?: number;
  enterDelay?: number;
  className?: string;
  paneRef?: (id: string, el: HTMLElement | null) => void;
  onFocus: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, pos: { x: number; y: number }) => void;
  onUnlink: (id: string) => void;
  children: ReactNode;
}

/** A draggable, weavable, flickable field pane (Aurora idiom). Fully
 * controlled: the parent owns position; weave groups decide who moves along. */
export function Pane({
  id,
  title,
  sub,
  x,
  y,
  w,
  z,
  agent,
  woven,
  weaveHint,
  top,
  driftDelay = 0,
  enterDelay = 0,
  className,
  paneRef,
  onFocus,
  onDrag,
  onDragEnd,
  onUnlink,
  children,
}: PaneProps) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const tracker = useRef(new FlickTracker());
  const cancelFlick = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => cancelFlick.current?.(), []);

  const clamp = (nx: number, ny: number) => ({
    x: Math.min(Math.max(nx, 8), window.innerWidth - 220),
    y: Math.min(Math.max(ny, 16), window.innerHeight - 120),
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button,input')) return;
    cancelFlick.current?.();
    drag.current = { dx: e.clientX - x, dy: e.clientY - y };
    tracker.current.reset();
    tracker.current.push(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    onFocus(id);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    tracker.current.push(e.clientX, e.clientY);
    const c = clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy);
    onDrag(id, c.x, c.y);
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
        onMove: (nx, ny) => onDrag(id, nx, ny),
        onEnd: (ex, ey) => {
          onDragEnd(id, { x: ex, y: ey });
          setDragging(false);
        },
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
      ref={(el) => paneRef?.(id, el)}
      className={`pane pane-float nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] backdrop-saturate-[var(--nimi-backdrop-saturate)] ${agent ? 'pane-agent' : ''} ${className ?? ''}`}
      data-nimi-material="glass-regular"
      data-nimi-tone="panel"
      data-weave-hint={weaveHint || undefined}
      data-top={top || undefined}
      data-woven={woven || undefined}
      data-dragging={dragging || undefined}
      style={{ left: x, top: y, width: w, zIndex: z, animationDelay: `${enterDelay}s` }}
      aria-label={title}
    >
      <div className="pane-drift" style={{ animationDelay: `${driftDelay}s` }}>
        {title ? (
          <div
            className="pane-head"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <span className="pane-title">{title}</span>
            <span className="pane-head-right">
              {woven ? (
                <button type="button" className="weave-chip" title="拆分编织" onClick={() => onUnlink(id)}>
                  ⇋ 已编织
                </button>
              ) : null}
              {sub ? <span className="t-caption">{sub}</span> : null}
            </span>
          </div>
        ) : (
          <div
            className="pane-grip"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-hidden
          />
        )}
        <div className="pane-body">{children}</div>
      </div>
    </section>
  );
}
