import React, { type HTMLAttributes } from 'react';
import { cn } from '../design-tokens.js';

type ProgressIndicatorProps = HTMLAttributes<HTMLDivElement> & {
  value?: number;
  max?: number;
  showValue?: boolean;
  indeterminate?: boolean;
};

export function ProgressIndicator({
  value,
  max = 100,
  showValue = false,
  indeterminate = false,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-valuetext': ariaValueText,
  ...rest
}: ProgressIndicatorProps) {
  const known = typeof value === 'number' && Number.isFinite(value) && Number.isFinite(max) && max > 0;
  const waiting = indeterminate && !known;
  const current = known ? Math.max(0, Math.min(max, value)) : undefined;
  const percentage = current === undefined ? undefined : current / max * 100;
  return (
    <div className={cn('nimi-progress flex min-w-0 items-center gap-3', className)} {...rest}>
      <div className={cn('nimi-progress__track', known || waiting ? 'h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--nimi-surface-active)]' : 'sr-only')} role="progressbar" data-state={waiting ? 'indeterminate' : undefined} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} aria-valuetext={ariaValueText} aria-valuemin={0} aria-valuemax={known ? max : undefined} aria-valuenow={current}>
        {waiting ? <div aria-hidden="true" className="h-full w-full bg-[repeating-linear-gradient(120deg,transparent_0_6px,var(--nimi-border-strong)_6px_10px)] motion-safe:animate-pulse" /> : null}
        {known ? <div className="nimi-progress__bar h-full w-full rounded-full bg-[var(--nimi-action-primary-bg)] transition-transform duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] motion-reduce:transition-none" style={{ transform: `translateX(${(percentage ?? 0) - 100}%)` }} /> : null}
      </div>
      {showValue && percentage !== undefined ? <span className="nimi-progress__value min-w-9 text-right tabular-nums text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-text-secondary)]">{Math.round(percentage)}%</span> : null}
    </div>
  );
}
