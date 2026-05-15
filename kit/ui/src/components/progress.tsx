import React, { type HTMLAttributes } from 'react';
import { cn } from '../design-tokens.js';

type ProgressIndicatorProps = HTMLAttributes<HTMLDivElement> & {
  value: number;
  max?: number;
  showValue?: boolean;
};

export function ProgressIndicator({
  value,
  max = 100,
  showValue = false,
  className,
  ...rest
}: ProgressIndicatorProps) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn('nimi-progress flex min-w-0 items-center gap-3', className)} {...rest}>
      <div className="nimi-progress__track h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--nimi-surface-active)]" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="nimi-progress__bar h-full rounded-full bg-[var(--nimi-action-primary-bg)] transition-[width] duration-[var(--nimi-motion-fast)]" style={{ width: `${percentage}%` }} />
      </div>
      {showValue ? <span className="nimi-progress__value min-w-9 text-right text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-text-secondary)]">{Math.round(percentage)}%</span> : null}
    </div>
  );
}
