import { useState } from 'react';
import { Surface, cn } from '@nimiplatform/nimi-kit/ui';

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
      elevation="raised"
      padding="none"
      tone="card"
      className="overflow-hidden rounded-3xl"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-6 py-5 text-left font-[inherit]"
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-3">
          <span className="whitespace-nowrap text-[15px] font-semibold text-[var(--nimi-text-primary)]">
            {title}
          </span>
          {count !== undefined && (
            <span className="whitespace-nowrap font-mono text-[12px] text-[var(--nimi-text-muted)]">
              {count}
            </span>
          )}
          {hint && (
            <span className="whitespace-nowrap text-[12px] text-[var(--nimi-text-muted)] opacity-[var(--nimi-opacity-muted)]">
              · {hint}
            </span>
          )}
        </div>
        <span
          aria-hidden
          className={cn(
            'grid place-items-center text-[var(--nimi-text-muted)] transition-transform duration-[var(--nimi-motion-medium)]',
            open ? 'rotate-180' : 'rotate-0',
          )}
        >
          <ChevronIcon />
        </span>
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
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
    <div className="py-1">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nimi-text-muted)]">
        {label}
      </div>
      <div className="text-[24px] font-bold tracking-[-0.02em] text-[var(--nimi-text-primary)]">
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[12px] text-[var(--nimi-text-muted)]">
          {sub}
        </div>
      )}
    </div>
  );
}
