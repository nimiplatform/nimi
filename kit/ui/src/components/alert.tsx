import React, { type HTMLAttributes, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type FeedbackTone } from '../design-tokens.js';

const alertVariants = cva(
  'nimi-inline-alert flex min-w-0 items-start gap-3 rounded-[var(--nimi-radius-md)] border px-3 py-2 text-[length:var(--nimi-type-body-sm-size)]',
  {
    variants: {
      tone: {
        neutral: 'nimi-inline-alert--neutral border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]',
        success: 'nimi-inline-alert--success border-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,transparent)] text-[var(--nimi-status-success)]',
        warning: 'nimi-inline-alert--warning border-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] text-[var(--nimi-status-warning)]',
        danger: 'nimi-inline-alert--danger border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] text-[var(--nimi-status-danger)]',
        info: 'nimi-inline-alert--info border-[color-mix(in_srgb,var(--nimi-status-info)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_10%,transparent)] text-[var(--nimi-status-info)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

type InlineAlertProps = HTMLAttributes<HTMLDivElement> & {
  tone?: FeedbackTone;
  icon?: ReactNode;
  action?: ReactNode;
};

export function InlineAlert({
  tone = 'neutral',
  icon,
  action,
  className,
  children,
  ...rest
}: InlineAlertProps) {
  return (
    <div className={cn(alertVariants({ tone }), className)} role={tone === 'danger' ? 'alert' : 'status'} {...rest}>
      {icon ? <span className="nimi-inline-alert__icon inline-flex shrink-0 items-center justify-center">{icon}</span> : null}
      <div className="nimi-inline-alert__body min-w-0 flex-1">{children}</div>
      {action ? <div className="nimi-inline-alert__action shrink-0">{action}</div> : null}
    </div>
  );
}
