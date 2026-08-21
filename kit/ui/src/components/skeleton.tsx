import React, { type HTMLAttributes } from 'react';
import { cn } from '../design-tokens.js';

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  lines?: number;
  /** Localized loading text announced by assistive technology. */
  label?: string;
};

export function LoadingSkeleton({
  lines = 3,
  label,
  className,
  ...rest
}: SkeletonProps) {
  const announced = Boolean(label?.trim());
  return (
    <div
      {...rest}
      className={cn('nimi-skeleton flex min-w-0 items-start gap-3', className)}
      role={announced ? 'status' : undefined}
      aria-live={announced ? 'polite' : undefined}
      aria-hidden={announced ? undefined : true}
    >
      {announced ? <span className="sr-only">{label}</span> : null}
      <div className="nimi-skeleton__media h-10 w-10 shrink-0 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]" />
      <div className="nimi-skeleton__body flex min-w-0 flex-1 flex-col gap-2">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className="nimi-skeleton__line h-3 rounded-full bg-[var(--nimi-surface-active)]"
            style={{ width: `${Math.max(42, 100 - index * 14)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
