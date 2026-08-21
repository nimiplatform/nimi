import { useEffect, useState, type ReactNode } from 'react';
import { animate, motion } from 'motion/react';
import { cn } from '@nimiplatform/kit/ui';
import { useDesktopReducedMotion } from '../../ui/motion/desktop-motion';

const EASE_EMPHASIZED = [0.05, 0.7, 0.1, 1] as const;

// Staggered section reveal for the overview dashboard. Returns props ready to
// spread onto a motion.div; honors the app/OS reduced-motion preference.
export function useOverviewReveal() {
  const reduced = useDesktopReducedMotion();
  return (order: number) => ({
    initial: reduced ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: reduced ? 0 : 0.4,
      delay: reduced ? 0 : order * 0.06,
      ease: EASE_EMPHASIZED,
    },
  });
}

// Animates a numeric value from its previous rendered value to the next one.
// Falls back to an immediate jump under reduced motion or non-finite input.
export function useCountUp(value: number): number {
  const reduced = useDesktopReducedMotion();
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (reduced || !Number.isFinite(value)) {
      setDisplay(value);
      return;
    }
    const controls = animate(display, value, {
      duration: 0.6,
      ease: EASE_EMPHASIZED,
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
    // `display` is intentionally captured as the animation start value only.
  }, [value, reduced]);
  return display;
}

export type GaugeTone = 'info' | 'action' | 'warning';

const GAUGE_TONE_COLOR: Record<GaugeTone, string> = {
  info: 'var(--nimi-status-info)',
  action: 'var(--nimi-action-primary-bg)',
  warning: 'var(--nimi-status-warning)',
};

const GAUGE_RADIUS = 40;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

// Circular gauge used by the system-resources card. The arc animates whenever
// the polled percentage changes; center shows the percentage, caption below.
export function GaugeRing({
  percent,
  tone,
  icon,
  label,
  detail,
}: {
  percent: number;
  tone: GaugeTone;
  icon: ReactNode;
  label: string;
  detail?: string;
}) {
  const reduced = useDesktopReducedMotion();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const targetOffset = GAUGE_CIRCUMFERENCE * (1 - clamped / 100);
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={GAUGE_RADIUS}
            fill="none"
            stroke="var(--nimi-surface-panel)"
            strokeWidth="9"
          />
          <motion.circle
            cx="50"
            cy="50"
            r={GAUGE_RADIUS}
            fill="none"
            stroke={GAUGE_TONE_COLOR[tone]}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={GAUGE_CIRCUMFERENCE}
            initial={reduced ? false : { strokeDashoffset: GAUGE_CIRCUMFERENCE }}
            animate={{ strokeDashoffset: targetOffset }}
            transition={{ duration: reduced ? 0 : 0.8, ease: EASE_EMPHASIZED }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-[var(--nimi-text-primary)]">
            {clamped.toFixed(0)}
            <span className="text-xs font-medium text-[var(--nimi-text-muted)]">%</span>
          </span>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
        <span className="text-[var(--nimi-text-muted)]">{icon}</span>
        {label}
      </p>
      {detail ? (
        <p className={cn('max-w-full truncate text-[length:var(--nimi-type-caption-size)] tabular-nums text-[var(--nimi-text-muted)]')} title={detail}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}
