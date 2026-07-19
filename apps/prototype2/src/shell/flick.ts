/* Flick momentum for field panes (Aurora's "flick them" idiom). */

import { animate, nimiSpring, projectMomentum } from '@nimiplatform/kit/ui/motion';

export class FlickTracker {
  private pts: Array<{ x: number; y: number; t: number }> = [];

  reset(): void {
    this.pts = [];
  }

  push(x: number, y: number): void {
    this.pts.push({ x, y, t: performance.now() });
    if (this.pts.length > 8) this.pts.shift();
  }

  velocity(): { vx: number; vy: number } {
    const now = performance.now();
    const recent = this.pts.filter((p) => now - p.t <= 120);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const last = recent[recent.length - 1];
    const prev = recent[0];
    const dt = Math.max(last.t - prev.t, 1) / 1000;
    const cap = 2600;
    const clamp = (v: number) => Math.max(-cap, Math.min(cap, v));
    return { vx: clamp((last.x - prev.x) / dt), vy: clamp((last.y - prev.y) / dt) };
  }
}

interface FlickOptions {
  vx: number;
  vy: number;
  from: { x: number; y: number };
  clamp: (x: number, y: number) => { x: number; y: number };
  onMove: (x: number, y: number) => void;
  onEnd: (x: number, y: number) => void;
}

/** Settle a released pane with the governed momentum spring and inherited
 * velocity; calls onEnd where it lands so a flick can weave on touchdown. */
export function startFlick(opts: FlickOptions): () => void {
  const { vx, vy } = opts;
  if (Math.hypot(vx, vy) < 80) {
    opts.onEnd(opts.from.x, opts.from.y);
    return () => undefined;
  }

  const landing = opts.clamp(
    opts.from.x + projectMomentum(vx, 0.99),
    opts.from.y + projectMomentum(vy, 0.99),
  );
  let x = opts.from.x;
  let y = opts.from.y;
  let completedAxes = 0;
  let cancelled = false;
  const publish = () => {
    const current = opts.clamp(x, y);
    opts.onMove(current.x, current.y);
  };
  const finishAxis = () => {
    completedAxes += 1;
    if (completedAxes !== 2 || cancelled) return;
    const finalPosition = opts.clamp(landing.x, landing.y);
    opts.onMove(finalPosition.x, finalPosition.y);
    opts.onEnd(finalPosition.x, finalPosition.y);
  };
  const spring = nimiSpring('momentum');
  const xAnimation = animate(opts.from.x, landing.x, {
    ...spring,
    velocity: landing.x === opts.from.x ? 0 : vx,
    onUpdate: (value) => {
      x = value;
      publish();
    },
    onComplete: finishAxis,
  });
  const yAnimation = animate(opts.from.y, landing.y, {
    ...spring,
    velocity: landing.y === opts.from.y ? 0 : vy,
    onUpdate: (value) => {
      y = value;
      publish();
    },
    onComplete: finishAxis,
  });

  return () => {
    cancelled = true;
    xAnimation.stop();
    yAnimation.stop();
  };
}
