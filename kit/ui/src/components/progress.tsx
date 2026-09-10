import React, { type HTMLAttributes } from 'react';
import { cn } from '../design-tokens.js';

type ProgressIndicatorProps = HTMLAttributes<HTMLDivElement> & {
  value?: number;
  max?: number;
  showValue?: boolean;
};

export function ProgressIndicator({
  value,
  max = 100,
  showValue = false,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-valuetext': ariaValueText,
  ...rest
}: ProgressIndicatorProps) {
  const known = typeof value === 'number' && Number.isFinite(value) && Number.isFinite(max) && max > 0;
  const current = known ? Math.max(0, Math.min(max, value)) : undefined;
  const percentage = current === undefined ? undefined : current / max * 100;
  return (
    <div className={cn('nimi-progress flex min-w-0 items-center gap-3', className)} {...rest}>
      <div className={cn('nimi-progress__track', known ? 'h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--nimi-surface-active)]' : 'sr-only')} role="progressbar" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} aria-valuetext={ariaValueText} aria-valuemin={0} aria-valuemax={known ? max : undefined} aria-valuenow={current}>
        {known ? <div className="nimi-progress__bar h-full rounded-full bg-[var(--nimi-action-primary-bg)] transition-[width] duration-[var(--nimi-motion-fast)] motion-reduce:transition-none" style={{ width: `${percentage}%` }} /> : null}
      </div>
      {showValue && percentage !== undefined ? <span className="nimi-progress__value min-w-9 text-right text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-text-secondary)]">{Math.round(percentage)}%</span> : null}
    </div>
  );
}
