import type { CSSProperties, ReactNode } from 'react';
import { sealGradientFor, worldInitial } from './world-list-atoms';
import type { WorldListItem } from './world-list-model';

export function Seal({
  world,
  size = 46,
  radius = 13,
}: {
  world: WorldListItem;
  size?: number;
  radius?: number;
}) {
  const iconUrl = world.iconUrl;
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: radius,
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        background: iconUrl ? `url(${iconUrl}) center/cover no-repeat` : sealGradientFor(world.id),
        color: '#ffffff',
        fontFamily: 'var(--nimi-font-display)',
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        letterSpacing: 0,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.48), 0 10px 24px rgba(57,78,118,0.14)',
      }}
    >
      {iconUrl ? null : worldInitial(world.name)}
    </div>
  );
}

export function IconSearch() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.7-3.7" />
    </svg>
  );
}

export function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
    </svg>
  );
}

export function IconList() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function IconArrow() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconSpark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
    </svg>
  );
}

export function IconShare() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
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

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'mint' | 'blue' | 'violet' }) {
  const styleByTone: Record<typeof tone, CSSProperties> = {
    neutral: {
      color: '#475569',
      background: 'rgba(148,163,184,0.13)',
      borderColor: 'rgba(148,163,184,0.12)',
    },
    mint: {
      color: '#12876d',
      background: 'rgba(69,208,170,0.16)',
      borderColor: 'rgba(69,208,170,0.10)',
    },
    blue: {
      color: '#3466d7',
      background: 'rgba(76,125,245,0.14)',
      borderColor: 'rgba(76,125,245,0.10)',
    },
    violet: {
      color: '#6e52d9',
      background: 'rgba(138,120,255,0.14)',
      borderColor: 'rgba(138,120,255,0.10)',
    },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 24,
        borderRadius: 999,
        border: '1px solid',
        padding: '0 10px',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        ...styleByTone[tone],
      }}
    >
      {children}
    </span>
  );
}
