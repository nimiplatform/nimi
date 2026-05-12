import { useState } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { S } from '../../app-shell/page-style.js';

interface Props {
  title: string;
  /** Optional secondary fragment shown next to the title (e.g. row count). */
  count?: string;
  /** Optional tertiary hint shown after the count. */
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Generic collapsible "Details" accordion card. Used by the orthodontic
 * page to tuck the journey timeline and the recent-trends stat grid under
 * a single tap so the primary hero / tray / next-visit cards stay visually
 * dominant.
 *
 * No animation libraries, no portal — the surface is intentionally simple
 * so the page-level layout can use any number of these in a vertical
 * stack without paying motion cost.
 */
export function OrthodonticDetailsSection({
  title,
  count,
  hint,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Surface
      as="section"
      material="glass-regular"
      padding="none"
      tone="card"
      className="rounded-[24px] overflow-hidden shadow-[0_6px_18px_rgba(15,23,42,0.04)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%',
          padding: '20px 24px',
          border: 0,
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: S.text,
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </span>
          {count !== undefined && (
            <span
              style={{
                fontSize: 12,
                color: 'var(--nimi-text-muted)',
                fontFamily: 'var(--nimi-font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              {count}
            </span>
          )}
          {hint && (
            <span
              style={{
                fontSize: 12,
                // slate-400 — kit fg-4 缺位；hint 比 count 再淡一档，避免与
                // count 抢视觉。
                color: '#94a3b8',
                whiteSpace: 'nowrap',
              }}
            >
              · {hint}
            </span>
          )}
        </div>
        <span
          aria-hidden
          style={{
            color: 'var(--nimi-text-muted)',
            display: 'grid',
            placeItems: 'center',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 240ms',
          }}
        >
          <ChevronIcon />
        </span>
      </button>
      {open && <div style={{ padding: '0 24px 24px' }}>{children}</div>}
    </Surface>
  );
}

function ChevronIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Compact stat tile for use inside a Details body. Matches the visual rhythm
 * of `Stat` in the tray progress card so the two surfaces feel kin.
 */
export function DetailsStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div style={{ padding: '4px 0' }}>
      <div
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--nimi-text-muted)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: 'var(--nimi-text-primary)',
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--nimi-text-muted)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
