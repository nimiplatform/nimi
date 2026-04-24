import type { CSSProperties, ReactNode } from 'react';

const SEAL_GRADIENTS = [
  'linear-gradient(135deg, #a78bfa 0%, #6d28d9 100%)',
  'linear-gradient(135deg, #fde68a 0%, #f59e0b 100%)',
  'linear-gradient(135deg, #c4b5fd 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #fbcfe8 0%, #ec4899 100%)',
  'linear-gradient(135deg, #86efac 0%, #059669 100%)',
  'linear-gradient(135deg, #67e8f9 0%, #0e7490 100%)',
  'linear-gradient(135deg, #fca5a5 0%, #b91c1c 100%)',
  'linear-gradient(135deg, #93c5fd 0%, #1d4ed8 100%)',
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function sealGradientFor(id: string): string {
  return SEAL_GRADIENTS[hashId(id) % SEAL_GRADIENTS.length] ?? SEAL_GRADIENTS[0]!;
}

export function pulseFromId(id: string, length = 16): number[] {
  const base = hashId(id || 'seed');
  const out: number[] = [];
  let x = base || 1;
  for (let i = 0; i < length; i += 1) {
    x = (x * 1103515245 + 12345) >>> 0;
    const r = (x % 1000) / 1000;
    const eased = 0.35 + 0.55 * r;
    out.push(Math.max(0.15, Math.min(0.98, eased)));
  }
  return out;
}

export function formatNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) {
    const v = n / 1000;
    return `${v.toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, '')}k`;
  }
  return String(Math.round(n));
}

type SealProps = {
  letter: string;
  gradient?: string;
  imageUrl?: string | null;
  size?: number;
  radius?: number;
  className?: string;
};

export function Seal({ letter, gradient, imageUrl, size = 56, radius = 14, className }: SealProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: radius,
    background: imageUrl ? `url(${imageUrl}) center/cover no-repeat` : gradient,
    display: 'grid',
    placeItems: 'center',
    color: '#ffffff',
    fontSize: Math.round(size * 0.42),
    fontWeight: 600,
    fontFamily: 'var(--nimi-font-display)',
    letterSpacing: '-0.02em',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 8px rgba(0,0,0,0.15), 0 6px 18px rgba(15,23,42,0.12)',
    overflow: 'hidden',
  };
  return (
    <div className={className} style={style}>
      {!imageUrl && letter}
    </div>
  );
}

type PulseProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  gradientId?: string;
};

export function Pulse({ data, width = 120, height = 28, color = 'var(--nimi-action-primary-bg)', gradientId }: PulseProps) {
  if (!data.length) return null;
  const max = Math.max(...data, 0.001);
  const step = width / Math.max(1, data.length - 1);
  const pts = data
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height * 0.9 - 2).toFixed(1)}`)
    .join(' ');
  const area = `0,${height} ${pts} ${width},${height}`;
  const fadeId = gradientId ?? `pulseFade-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${fadeId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function StatusDot({ active, activeLabel, idleLabel }: { active: boolean; activeLabel: string; idleLabel: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: active ? 'var(--nimi-action-primary-bg)' : 'var(--nimi-text-muted)',
      }}
    >
      {active && <span className="desktop-world-pulse-dot" aria-hidden="true" />}
      {active ? activeLabel : idleLabel}
    </span>
  );
}

export function Kicker({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div
      className={className}
      style={{
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: 'var(--nimi-text-muted)',
        fontFamily: 'var(--nimi-font-mono)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type StatProps = { label: string; value: ReactNode; sub?: ReactNode; valueSize?: number };

export function Stat({ label, value, sub, valueSize = 18 }: StatProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <Kicker style={{ fontSize: 9 }}>{label}</Kicker>
      <div
        style={{
          fontSize: valueSize,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: 'var(--nimi-text-primary)',
          fontFamily: 'var(--nimi-font-mono)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, color: 'var(--nimi-text-muted)' }}>{sub}</div> : null}
    </div>
  );
}

export function Chip({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 8px',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 500,
        color: muted ? 'var(--nimi-text-muted)' : 'var(--nimi-text-secondary)',
        background: 'rgba(148,163,184,0.12)',
        border: '1px solid rgba(148,163,184,0.16)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
