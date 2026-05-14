/**
 * Size-configurable progress ring for the multi-appliance orthodontic surface.
 * Renders an `ApplianceRingView` (see `appliance-ring-view.ts`) — the hero card
 * uses a large ring, the compact card a small one; both share this component
 * so the visual language stays identical regardless of slot.
 */
import type { ApplianceRingView } from './appliance-ring-view.js';

export function ApplianceRing({
  view,
  size = 200,
  stroke = 16,
}: {
  view: ApplianceRingView;
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio =
    view.kind === 'metric' && view.ratio !== null
      ? Math.max(0, Math.min(1, view.ratio))
      : 0;
  const hasFill = view.kind === 'metric' && view.ratio !== null;
  const dash = circumference * ratio;
  const isSmall = size < 120;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(15,23,42,0.06)"
          strokeWidth={stroke}
          fill="none"
        />
        {hasFill && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={view.accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: 'stroke-dasharray 600ms ease, stroke 240ms' }}
          />
        )}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: isSmall ? '0 8px' : '0 24px',
        }}
      >
        {view.kind === 'metric' ? (
          <>
            <div
              style={{
                fontSize: isSmall ? 10 : 12,
                color: 'var(--nimi-text-muted)',
                letterSpacing: '0.04em',
                fontWeight: 500,
                marginBottom: isSmall ? 1 : 4,
              }}
            >
              {view.caption}
            </div>
            <div
              style={{
                fontSize: isSmall ? 26 : 52,
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1,
                color: 'var(--nimi-text-primary)',
              }}
            >
              {view.value}
              <span
                style={{
                  fontSize: isSmall ? 11 : 20,
                  color: 'var(--nimi-text-muted)',
                  marginLeft: 2,
                  fontWeight: 600,
                }}
              >
                {view.unit}
              </span>
            </div>
            {view.footer && !isSmall && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--nimi-text-muted)',
                  marginTop: 8,
                  fontFamily: 'var(--nimi-font-mono)',
                }}
              >
                {view.footer}
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              fontSize: isSmall ? 11 : 13,
              color: 'var(--nimi-text-muted)',
              lineHeight: 1.5,
            }}
          >
            {view.message}
          </div>
        )}
      </div>
    </div>
  );
}
