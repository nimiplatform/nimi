import { cn } from '@nimiplatform/nimi-kit/ui';

export type ModelSelectorTriggerProps = {
  source: 'local' | 'cloud' | null;
  modelLabel: string | null;
  detail?: string | null;
  placeholder?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
};

const LOCAL_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const CLOUD_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);

const CHEVRON_RIGHT = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7.5 5L12.5 10L7.5 15" />
  </svg>
);

export function ModelSelectorTrigger({
  source,
  modelLabel,
  detail,
  placeholder = 'Select a model',
  onClick,
  disabled,
  className,
}: ModelSelectorTriggerProps) {
  const hasModel = Boolean(modelLabel);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
        hasModel
          ? 'border-slate-200 bg-white hover:border-slate-300'
          : 'border-dashed border-slate-200 bg-slate-50/50 hover:border-emerald-400',
        disabled ? 'cursor-not-allowed opacity-60' : '',
        className,
      )}
    >
      {hasModel && source ? (
        <span className="shrink-0 text-slate-400">
          {source === 'local' ? LOCAL_ICON : CLOUD_ICON}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {hasModel ? (
          <>
            <p className="truncate text-[13px] font-medium text-slate-800">{modelLabel}</p>
            {detail ? (
              <p className="truncate text-[11px] text-slate-400">{detail}</p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-slate-400">{placeholder}</p>
        )}
      </div>
      <span className="shrink-0 text-slate-300">{CHEVRON_RIGHT}</span>
    </button>
  );
}
