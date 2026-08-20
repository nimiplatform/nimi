import type { CSSProperties, ReactNode } from 'react';
import { Avatar, IconButton, cn } from '@nimiplatform/kit/ui';
import { ArrowLeft, ArrowRight, MoreHorizontal, Share2 } from 'lucide-react';
import { worldInitial } from './world-list-atoms';

export const GLASS_STYLE: CSSProperties = {
  background: 'var(--nimi-material-glass-regular-bg)',
  border: '1px solid var(--nimi-material-glass-regular-border)',
  boxShadow: 'var(--nimi-elevation-floating)',
};

export const GLASS_STRONG_STYLE: CSSProperties = {
  background: 'var(--nimi-material-glass-thick-bg)',
  border: '1px solid var(--nimi-material-glass-thick-border)',
  boxShadow: 'var(--nimi-elevation-floating)',
};

export const GLASS_SURFACE_CLASS = 'nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]';
export const GLASS_STRONG_SURFACE_CLASS = 'nimi-material-glass-thick backdrop-blur-[var(--nimi-backdrop-blur-strong)]';

export function IconArrowLeft() {
  return <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.9} />;
}

export function IconArrowRight() {
  return <ArrowRight aria-hidden="true" size={18} strokeWidth={1.9} />;
}

export function IconDots() {
  return <MoreHorizontal aria-hidden="true" size={18} strokeWidth={2} />;
}

export function IconShare() {
  return <Share2 aria-hidden="true" size={18} strokeWidth={1.9} />;
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
    <IconButton
      aria-label={label}
      onClick={onClick}
      icon={children}
      tone="ghost"
      size="md"
      className="h-[38px] w-[38px] border border-white/30 bg-[var(--nimi-overlay-backdrop)] text-[var(--nimi-text-inverse)] hover:bg-[var(--nimi-scrim-modal)] hover:text-[var(--nimi-text-inverse)]"
    />
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
      color: 'var(--nimi-status-neutral-soft-text)',
      background: 'var(--nimi-status-neutral-soft-bg)',
      borderColor: 'var(--nimi-status-neutral-soft-border)',
    },
    mint: {
      color: 'var(--nimi-status-success-soft-text)',
      background: 'var(--nimi-status-success-soft-bg)',
      borderColor: 'var(--nimi-status-success-soft-border)',
    },
    blue: {
      color: 'var(--nimi-status-info-soft-text)',
      background: 'var(--nimi-status-info-soft-bg)',
      borderColor: 'var(--nimi-status-info-soft-border)',
    },
    violet: {
      color: 'var(--nimi-color-indigo)',
      background: 'color-mix(in srgb, var(--nimi-color-indigo) 14%, transparent)',
      borderColor: 'color-mix(in srgb, var(--nimi-color-indigo) 22%, transparent)',
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
      className="overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        flex: '0 0 auto',
        color: '#ffffff',
        fontSize: Math.round(size * 0.38),
        fontWeight: 900,
        background: displayImage
          ? `url(${displayImage}) center/cover no-repeat`
          : 'linear-gradient(135deg, var(--nimi-action-primary-bg), var(--nimi-color-indigo))',
        boxShadow: 'var(--nimi-elevation-raised)',
      }}
    >
      <Avatar
        alt={name}
        src={displayImage}
        size="lg"
        shape="rounded"
        tone="accent"
        className={cn('h-full w-full bg-transparent text-white')}
        fallbackClassName="bg-transparent font-black"
        fallback={worldInitial(name)}
      />
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
        borderRadius: 'var(--nimi-radius-xl)',
        padding: 20,
        minWidth: 0,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, color: 'var(--nimi-text-primary)', fontSize: 16, fontWeight: 950, letterSpacing: 0 }}>{title}</h2>
          {subtitle ? <p style={{ margin: '5px 0 0', color: 'var(--nimi-text-secondary)', fontSize: 12, lineHeight: 1.5, fontWeight: 650 }}>{subtitle}</p> : null}
        </div>
        {action ? <div style={{ flex: '0 0 auto' }}>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function InfoTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ borderRadius: 'var(--nimi-radius-md)', padding: 14, minWidth: 0, background: 'color-mix(in srgb, var(--nimi-surface-card) 62%, transparent)', border: '1px solid var(--nimi-border-subtle)' }}>
      <div style={{ color: 'var(--nimi-text-primary)', fontSize: 13, fontWeight: 950, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      <div style={{ color: 'var(--nimi-text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', marginTop: 5 }}>{label}</div>
    </div>
  );
}

export function PanelTitle({ title }: { title: string }) {
  return <h3 style={{ margin: 0, color: 'var(--nimi-text-primary)', fontSize: 14, fontWeight: 950, letterSpacing: 0 }}>{title}</h3>;
}
