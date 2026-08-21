import React from 'react';
import { cn } from '@nimiplatform/kit/ui';

export type ModelSelectorTriggerProps = {
  readonly label: string | null;
  readonly detail?: string | null;
  readonly source?: 'local' | 'cloud' | null;
  readonly detailStatus?: string | null;
  readonly detailTone?: 'success' | 'warning' | 'neutral';
  readonly hoverBorderTone?: 'neutral' | 'success';
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly className?: string;
  readonly dataTestId?: string;
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

export function ModelSelectorTrigger({
  label,
  detail,
  source = null,
  detailStatus,
  detailTone = 'neutral',
  hoverBorderTone = 'neutral',
  placeholder,
  disabled,
  onClick,
  className,
  dataTestId,
}: ModelSelectorTriggerProps) {
  const hasModel = Boolean(label);
  const hasDetail = Boolean(detail || detailStatus);
  return (
    <button
      type="button"
      data-testid={dataTestId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-10 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-[var(--nimi-radius-md)] border px-3 py-2.5 text-left transition-colors',
        hasModel
          ? cn(
            'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]',
            hoverBorderTone === 'success'
              ? 'hover:border-[var(--nimi-status-success)]'
              : 'hover:border-[var(--nimi-border-strong)]',
          )
          : 'border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] hover:border-[var(--nimi-action-primary-bg)]',
        disabled ? 'cursor-not-allowed opacity-[var(--nimi-opacity-disabled)]' : 'cursor-pointer',
        className,
      )}
    >
      {hasModel && source ? (
        <span className="shrink-0 text-[var(--nimi-text-muted)]">
          {source === 'local' ? LOCAL_ICON : CLOUD_ICON}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[length:var(--nimi-type-body-sm-size)]', label ? 'font-medium text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-field-placeholder)]')}>{label || placeholder}</span>
        {hasDetail ? (
          <span className={cn(
            'mt-0.5 block truncate text-[length:var(--nimi-type-overline-size)]',
            detailTone === 'success'
              ? 'font-medium text-[var(--nimi-status-success)]'
              : detailTone === 'warning'
                ? 'font-medium text-[var(--nimi-status-warning)]'
                : 'text-[var(--nimi-text-muted)]',
          )}>
            {detail ? <span>{detail}</span> : null}
            {detail && detailStatus ? <span aria-hidden="true"> · </span> : null}
            {detailStatus ? <span>{detailStatus}</span> : null}
          </span>
        ) : null}
      </span>
      <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--nimi-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
    </button>
  );
}
