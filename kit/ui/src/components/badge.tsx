import React, { type HTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type StatusTone } from '../design-tokens.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-[color-mix(in_srgb,var(--nimi-status-neutral)_15%,transparent)] text-[var(--nimi-status-neutral)]',
        success: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-[var(--nimi-status-success)]',
        warning: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] text-[var(--nimi-status-warning)]',
        danger: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_15%,transparent)] text-[var(--nimi-status-danger)]',
        info: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_15%,transparent)] text-[var(--nimi-status-info)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
};

export function StatusBadge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: StatusBadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...rest}>
      {children}
    </span>
  );
}
