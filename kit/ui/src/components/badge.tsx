import React, { type HTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type StatusBadgeShape, type StatusTone } from '../design-tokens.js';

const badgeVariants = cva(
  'nimi-status-badge inline-flex items-center gap-1.5 rounded-full text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'nimi-status-badge--neutral bg-[color-mix(in_srgb,var(--nimi-status-neutral)_15%,transparent)] text-[var(--nimi-status-neutral)]',
        success: 'nimi-status-badge--success bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-[var(--nimi-status-success)]',
        warning: 'nimi-status-badge--warning bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] text-[var(--nimi-status-warning)]',
        danger: 'nimi-status-badge--danger bg-[color-mix(in_srgb,var(--nimi-status-danger)_15%,transparent)] text-[var(--nimi-status-danger)]',
        info: 'nimi-status-badge--info bg-[color-mix(in_srgb,var(--nimi-status-info)_15%,transparent)] text-[var(--nimi-status-info)]',
      },
      shape: {
        soft: 'nimi-status-badge--soft px-2.5 py-0.5',
        outline: 'nimi-status-badge--outline border border-current bg-transparent px-2.5 py-0.5',
        dot: 'nimi-status-badge--dot px-2.5 py-0.5',
      },
    },
    defaultVariants: { tone: 'neutral', shape: 'soft' },
  },
);

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
  shape?: StatusBadgeShape;
};

export function StatusBadge({
  tone = 'neutral',
  shape = 'soft',
  className,
  children,
  ...rest
}: StatusBadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, shape }), className)} {...rest}>
      {shape === 'dot' ? <span className="nimi-status-badge__dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
