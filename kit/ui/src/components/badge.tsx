import React, { type HTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type StatusBadgeShape, type StatusTone } from '../design-tokens.js';

const badgeVariants = cva(
  'nimi-status-badge inline-flex items-center gap-1.5 rounded-full text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'nimi-status-badge--neutral bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]',
        success: 'nimi-status-badge--success bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]',
        warning: 'nimi-status-badge--warning bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]',
        danger: 'nimi-status-badge--danger bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]',
        info: 'nimi-status-badge--info bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]',
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
