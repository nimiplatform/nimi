import type { CSSProperties, ReactNode } from 'react';
import { worldInitial } from './world-list-atoms';

export const GLASS_STYLE: CSSProperties = {
  background: 'var(--nimi-material-glass-regular-bg)',
  border: '1px solid var(--nimi-material-glass-regular-border)',
  boxShadow: '0 18px 48px rgba(54,80,125,0.08)',
};

export const GLASS_STRONG_STYLE: CSSProperties = {
  background: 'var(--nimi-material-glass-thick-bg)',
  border: '1px solid var(--nimi-material-glass-thick-border)',
  boxShadow: '0 24px 58px rgba(54,80,125,0.10)',
};

export const GLASS_SURFACE_CLASS = 'nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]';
export const GLASS_STRONG_SURFACE_CLASS = 'nimi-material-glass-thick backdrop-blur-[var(--nimi-backdrop-blur-strong)]';

export function IconArrowLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

export function IconArrowRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconDots() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function IconShare() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

export function GlassButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 38,
        height: 38,
        borderRadius: 999,
        border: '1px solid rgba(255,255,255,0.28)',
        background: 'rgba(23,45,70,0.34)',
        color: '#ffffff',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'mint' | 'blue' | 'violet';
}) {
  const styleByTone: Record<'neutral' | 'mint' | 'blue' | 'violet', CSSProperties> = {
    neutral: {
      color: '#475569',
      background: 'rgba(148,163,184,0.12)',
      borderColor: 'rgba(148,163,184,0.12)',
    },
    mint: {
      color: '#12876d',
      background: 'rgba(69,208,170,0.16)',
      borderColor: 'rgba(69,208,170,0.12)',
    },
    blue: {
      color: '#3466d7',
      background: 'rgba(76,125,245,0.14)',
      borderColor: 'rgba(76,125,245,0.12)',
    },
    violet: {
      color: '#6e52d9',
      background: 'rgba(138,120,255,0.14)',
      borderColor: 'rgba(138,120,255,0.12)',
    },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 24,
        borderRadius: 999,
        border: '1px solid',
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 850,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...styleByTone[tone],
      }}
    >
      {children}
    </span>
  );
}

export function Seal({
  name,
  imageUrl,
  size = 66,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const displayImage = imageUrl || undefined;
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
        color: '#ffffff',
        fontSize: Math.round(size * 0.38),
        fontWeight: 900,
        background: displayImage
          ? `url(${displayImage}) center/cover no-repeat`
          : 'linear-gradient(135deg, #67d8c2, #4c7df5)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.48), 0 12px 28px rgba(54,80,125,0.16)',
      }}
    >
      {displayImage ? null : worldInitial(name)}
    </div>
  );
}

export function SectionCard({
  id,
  testId,
  title,
  subtitle,
  action,
  children,
  style,
}: {
  id?: string;
  testId?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      className={GLASS_SURFACE_CLASS}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
      id={id}
      data-testid={testId}
      style={{
        ...GLASS_STYLE,
        borderRadius: 20,
        padding: 20,
        minWidth: 0,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, color: '#111827', fontSize: 16, fontWeight: 950, letterSpacing: 0 }}>{title}</h2>
          {subtitle ? <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 12, lineHeight: 1.5, fontWeight: 650 }}>{subtitle}</p> : null}
        </div>
        {action ? <div style={{ flex: '0 0 auto' }}>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function InfoTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ borderRadius: 14, padding: 14, minWidth: 0, background: 'rgba(255,255,255,0.46)', border: '1px solid rgba(113,132,158,0.10)' }}>
      <div style={{ color: '#111827', fontSize: 13, fontWeight: 950, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      <div style={{ color: '#7a8799', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', marginTop: 5 }}>{label}</div>
    </div>
  );
}

export function PanelTitle({ title }: { title: string }) {
  return <h3 style={{ margin: 0, color: '#111827', fontSize: 14, fontWeight: 950, letterSpacing: 0 }}>{title}</h3>;
}
