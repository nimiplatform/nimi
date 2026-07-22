import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  top?: boolean;
  driftDelay?: number;
  enterDelay?: number;
  className?: string;
  actions?: ReactNode;
  onFocus: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  children: ReactNode;
}

/** A draggable, flickable field pane (Aurora idiom). The parent owns position. */
export function Pane({
  id,
  title,
  sub,
  x,
  y,
  w,
  z,
  agent,
  top,
  driftDelay = 0,
  enterDelay = 0,
  className,
  actions,
  onFocus,
  onDrag,
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
    if (window.matchMedia('(max-width: 720px), (max-height: 800px)').matches) return;
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
        onEnd: () => setDragging(false),
      });
      drag.current = null;
      if (!flicking) setDragging(false);
    } else {
      drag.current = null;
      setDragging(false);
    }
  };
  const onPointerCancel = () => {
    drag.current = null;
    tracker.current.reset();
    setDragging(false);
  };

  return (
    <section
      className={`pane pane-float nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] backdrop-saturate-[var(--nimi-backdrop-saturate)] ${agent ? 'pane-agent' : ''} ${className ?? ''}`}
      data-nimi-material="glass-regular"
      data-nimi-tone="panel"
      data-pane-id={id}
      data-top={top || undefined}
      data-dragging={dragging || undefined}
      style={{
        left: x,
        top: y,
        width: w,
        zIndex: z,
        '--pane-enter-delay': `${enterDelay}s`,
        '--pane-drift-delay': `${driftDelay}s`,
      } as CSSProperties}
      aria-label={title}
    >
      <div className="pane-drift">
        {title ? (
          <div
            className="pane-head"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            <span className="pane-title">{title}</span>
            <span className="pane-head-side">
              {sub ? <span className="t-caption">{sub}</span> : null}
              {actions}
            </span>
          </div>
        ) : (
          <div
            className="pane-grip"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            aria-hidden
          />
        )}
        <div className="pane-body">{children}</div>
      </div>
    </section>
  );
}
