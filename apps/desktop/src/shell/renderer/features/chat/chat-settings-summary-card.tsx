// ---------------------------------------------------------------------------
// SettingsSummaryCard — clickable card for the settings summary home
// ---------------------------------------------------------------------------

export type SettingsSummaryCardProps = {
  title: string;
  subtitle?: string | null;
  statusDot?: 'ready' | 'attention' | 'neutral';
  statusLabel?: string | null;
  onClick: () => void;
  disabled?: boolean;
};

const STATUS_DOT_CLASS: Record<string, string> = {
  ready: 'bg-[var(--nimi-status-success)]',
  attention: 'bg-[var(--nimi-status-warning)]',
  neutral: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)]',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  ready: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]',
  attention: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)]',
  neutral: 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]',
};

export function SettingsSummaryCard({
  title,
  subtitle,
  statusDot,
  statusLabel,
  onClick,
  disabled,
}: SettingsSummaryCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3.5 text-left transition-all duration-150 hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-card))] hover:shadow-sm active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-[11px] text-[var(--nimi-text-muted)]">{subtitle}</div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {statusDot ? (
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASS[statusDot] ?? STATUS_DOT_CLASS.neutral}`} />
        ) : null}
        {statusLabel ? (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE_CLASS[statusDot ?? 'neutral'] ?? STATUS_BADGE_CLASS.neutral}`}>
            {statusLabel}
          </span>
        ) : null}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-[var(--nimi-text-muted)] transition-colors group-hover:text-[var(--nimi-action-primary-bg)]"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>
    </button>
  );
}
