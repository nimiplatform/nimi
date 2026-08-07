import { cn } from '@nimiplatform/kit/ui';

export type ModelSelectorTriggerProps = {
  readonly label: string | null;
  readonly detail?: string | null;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly className?: string;
};

export function ModelSelectorTrigger({ label, detail, placeholder, disabled, onClick, className }: ModelSelectorTriggerProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-left transition-colors hover:border-[var(--nimi-field-focus)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
        className,
      )}
    >
      <span className="min-w-0">
        <span className={cn('block truncate text-sm', label ? 'font-medium text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-field-placeholder)]')}>{label || placeholder}</span>
        {detail ? <span className="mt-0.5 block truncate text-[11px] text-[var(--nimi-text-muted)]">{detail}</span> : null}
      </span>
      <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--nimi-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
    </button>
  );
}
