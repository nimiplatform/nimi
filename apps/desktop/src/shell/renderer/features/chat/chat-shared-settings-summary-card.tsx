// ---------------------------------------------------------------------------
// SettingsSummaryCard — clickable card for the settings summary home
// ---------------------------------------------------------------------------

export type SettingsSummaryCardProps = {
  title: string;
  subtitle?: string | null;
  statusDot?: 'ready' | 'attention' | 'neutral';
  statusLabel?: string | null;
  sourceBadge?: 'local' | 'cloud' | null;
  onClick: () => void;
  disabled?: boolean;
};

const SOURCE_BADGE_CLASS: Record<'local' | 'cloud', string> = {
  local: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  cloud: 'border border-indigo-200 bg-indigo-50 text-indigo-700',
};

const SOURCE_BADGE_LABEL: Record<'local' | 'cloud', string> = {
  local: 'LOCAL',
  cloud: 'CLOUD',
};

const STATUS_DOT_CLASS: Record<string, string> = {
  ready: 'bg-green-500',
  attention: 'bg-orange-500',
  neutral: 'bg-slate-300',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  ready: 'border border-green-100 bg-green-50',
  attention: 'border border-orange-100 bg-orange-50',
  neutral: 'border border-slate-100 bg-slate-50',
};

const STATUS_TEXT_CLASS: Record<string, string> = {
  ready: 'text-green-700',
  attention: 'text-orange-700',
  neutral: 'text-slate-500',
};

export function SettingsSummaryCard({
  title,
  subtitle,
  statusDot,
  statusLabel,
  sourceBadge,
  onClick,
  disabled,
}: SettingsSummaryCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-slate-300 hover:shadow-sm disabled:pointer-events-none disabled:opacity-50"
    >
      <div className="min-w-0">
        <h4 className="text-[15px] font-bold text-slate-800">{title}</h4>
        {subtitle ? (
          <p className="mt-1 truncate font-mono text-xs text-slate-500">
            <span className="inline-block rounded bg-slate-50 px-1.5 py-0.5">{subtitle}</span>
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {sourceBadge ? (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${SOURCE_BADGE_CLASS[sourceBadge]}`}
          >
            {SOURCE_BADGE_LABEL[sourceBadge]}
          </span>
        ) : null}
        {statusLabel ? (
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${STATUS_BADGE_CLASS[statusDot ?? 'neutral'] ?? STATUS_BADGE_CLASS.neutral}`}>
            <div className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[statusDot ?? 'neutral'] ?? STATUS_DOT_CLASS.neutral}`} />
            <span className={`text-[10px] font-bold uppercase tracking-wide ${STATUS_TEXT_CLASS[statusDot ?? 'neutral'] ?? STATUS_TEXT_CLASS.neutral}`}>
              {statusLabel}
            </span>
          </div>
        ) : null}
        <svg
          className="h-4 w-4 text-slate-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
