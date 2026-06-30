import type { CSSProperties, ReactNode } from 'react';
import { PAPER, PAPER_RADIUS, PAPER_SERIF } from './world-detail-paper-model';
import { worldInitial } from './world-list-atoms';

type IconProps = { size?: number; color?: string; strokeWidth?: number };

function strokeIcon(size: number, color: string, strokeWidth: number, children: ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconUsers({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ));
}

export function IconBook({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ));
}

export function IconScene({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <path d="m3 18 5-7 4 5 3-4 6 6" />
      <path d="M3 18h18" />
      <circle cx="8" cy="7" r="1.6" />
    </>
  ));
}

export function IconCompass({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <circle cx="12" cy="12" r="9" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </>
  ));
}

export function IconClock({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2.5 2.5" />
    </>
  ));
}

export function IconLayers({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </>
  ));
}

export function IconFile({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ));
}

export function IconShield({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2.5 2.5" />
    </>
  ));
}

export function IconChat({ size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  ));
}

export function IconArrow({ size = 14, color = 'currentColor', strokeWidth = 2 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ));
}

export function IconChevron({ size = 14, color = 'currentColor', strokeWidth = 2 }: IconProps) {
  return strokeIcon(size, color, strokeWidth, (
    <polyline points="9 18 15 12 9 6" />
  ));
}

/** Warm rice-paper avatar with a serif initial, used across the paper surface. */
export function PaperAvatar({
  name,
  imageUrl,
  size = 54,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const radius = size >= 48 ? Math.round(size * 0.26) : '50%';
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        border: `1.5px solid ${PAPER.avatarBorder}`,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        fontFamily: PAPER_SERIF,
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        color: PAPER.ink,
        boxShadow: 'inset 0 -6px 14px rgba(90,80,56,.16)',
        background: imageUrl
          ? `url(${imageUrl}) center/cover no-repeat`
          : PAPER.avatarGradient,
      }}
    >
      {imageUrl ? null : <span style={{ paddingBottom: Math.round(size * 0.1) }}>{worldInitial(name)}</span>}
    </div>
  );
}

/** Card section shell with the green tick + serif heading + "view all" action. */
export function PaperSection({
  id,
  testId,
  title,
  subtitle,
  action,
  children,
}: {
  id?: string;
  testId?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid={testId}
      style={{
        scrollMarginTop: 80,
        background: PAPER.card,
        border: `1px solid ${PAPER.border}`,
        borderRadius: PAPER_RADIUS.lg,
        boxShadow: PAPER.cardShadow,
        padding: '22px 24px',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <span style={{ width: 4, height: 18, borderRadius: 2, background: PAPER.green, flexShrink: 0 }} />
          <h2 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 20, fontWeight: 700, color: PAPER.inkStrong }}>{title}</h2>
        </div>
        {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
      </div>
      {subtitle ? <p style={{ margin: '0 0 16px', fontSize: 13, color: PAPER.faint }}>{subtitle}</p> : null}
      {children}
    </section>
  );
}

export function PaperViewAll({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        color: PAPER.green,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {label}
      <IconChevron size={14} color={PAPER.green} />
    </button>
  );
}

export function PaperTag({
  children,
  tone = 'green',
}: {
  children: ReactNode;
  tone?: 'green' | 'neutral';
}) {
  const palette = tone === 'green'
    ? { color: PAPER.green, background: PAPER.greenSoftBg }
    : { color: PAPER.muted, background: 'rgba(120,108,80,.1)' };
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        ...palette,
      }}
    >
      {children}
    </span>
  );
}

export const paperPrimaryButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  padding: '8px 15px',
  borderRadius: 9,
  border: 'none',
  background: PAPER.green,
  color: '#f6f2e7',
  cursor: 'pointer',
};

export const paperGhostButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  padding: 8,
  borderRadius: 9,
  border: `1px solid #d6c9ac`,
  background: PAPER.card,
  color: PAPER.ink,
  cursor: 'pointer',
};
