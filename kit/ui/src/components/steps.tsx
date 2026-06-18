import { Check } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn, type StatusTone } from '../design-tokens.js';

export type StepStatus = 'complete' | 'current' | 'pending' | 'error';

export type StepItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  status?: StepStatus;
};

export type StepsProps = {
  items: StepItem[];
  ariaLabel: string;
  className?: string;
};

const statusTone: Record<StepStatus, StatusTone | 'brand'> = {
  complete: 'success',
  current: 'brand',
  pending: 'neutral',
  error: 'danger',
};

const dotClass: Record<StatusTone | 'brand', string> = {
  brand: 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]',
  neutral: 'border-[var(--nimi-border-strong)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]',
  success: 'border-[var(--nimi-status-success)] bg-[var(--nimi-status-success)] text-white',
  warning: 'border-[var(--nimi-status-warning)] bg-[var(--nimi-status-warning)] text-white',
  danger: 'border-[var(--nimi-status-danger)] bg-[var(--nimi-status-danger)] text-white',
  info: 'border-[var(--nimi-status-info)] bg-[var(--nimi-status-info)] text-white',
};

export function Steps({ items, ariaLabel, className }: StepsProps) {
  return (
    <ol className={cn('nimi-steps grid gap-3', className)} aria-label={ariaLabel}>
      {items.map((item, index) => {
        const status = item.status ?? 'pending';
        const tone = statusTone[status];
        return (
          <li key={item.id} className="nimi-steps__item grid grid-cols-[28px_minmax(0,1fr)] gap-3">
            <span className="relative grid justify-items-center">
              <span className={cn('nimi-steps__dot z-10 grid h-7 w-7 place-items-center rounded-full border text-xs font-bold', dotClass[tone])}>
                {status === 'complete' ? <Check size={14} aria-hidden="true" /> : index + 1}
              </span>
              {index < items.length - 1 ? <span className="nimi-steps__connector absolute top-7 h-[calc(100%+12px)] w-px bg-[var(--nimi-border-subtle)]" aria-hidden="true" /> : null}
            </span>
            <span className="nimi-steps__body grid min-w-0 gap-1 pb-2">
              <span className="nimi-steps__title text-sm font-semibold text-[var(--nimi-text-primary)]">{item.title}</span>
              {item.description ? <span className="nimi-steps__description text-xs text-[var(--nimi-text-secondary)]">{item.description}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
