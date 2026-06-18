import { type ReactNode } from 'react';
import { cn, type StatusTone } from '../design-tokens.js';

export type StatisticTrend = 'up' | 'down' | 'flat';

export type StatisticProps = {
  label: ReactNode;
  value: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  helper?: ReactNode;
  trend?: StatisticTrend;
  tone?: StatusTone | 'brand';
  className?: string;
};

const trendMark: Record<StatisticTrend, string> = {
  up: '+',
  down: '-',
  flat: '=',
};

const toneClass: Record<NonNullable<StatisticProps['tone']>, string> = {
  brand: 'text-[var(--nimi-action-primary-bg)]',
  neutral: 'text-[var(--nimi-text-secondary)]',
  success: 'text-[var(--nimi-status-success)]',
  warning: 'text-[var(--nimi-status-warning)]',
  danger: 'text-[var(--nimi-status-danger)]',
  info: 'text-[var(--nimi-status-info)]',
};

export function Statistic({
  label,
  value,
  prefix,
  suffix,
  helper,
  trend,
  tone = 'neutral',
  className,
}: StatisticProps) {
  return (
    <div className={cn('nimi-statistic grid min-w-0 gap-1 rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3', className)}>
      <span className="nimi-statistic__label truncate text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-[var(--nimi-type-label-letter-spacing)] text-[var(--nimi-text-muted)]">
        {label}
      </span>
      <span className={cn('nimi-statistic__value flex min-w-0 items-baseline gap-1 text-2xl font-bold tracking-normal', toneClass[tone])}>
        {trend ? <span className="nimi-statistic__trend text-[length:var(--nimi-type-body-sm-size)]" aria-hidden="true">{trendMark[trend]}</span> : null}
        {prefix ? <span className="nimi-statistic__prefix text-[length:var(--nimi-type-body-size)]">{prefix}</span> : null}
        <span className="truncate">{value}</span>
        {suffix ? <span className="nimi-statistic__suffix text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">{suffix}</span> : null}
      </span>
      {helper ? <span className="nimi-statistic__helper text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">{helper}</span> : null}
    </div>
  );
}

export type StatisticGroupProps = {
  children: ReactNode;
  className?: string;
};

export function StatisticGroup({ children, className }: StatisticGroupProps) {
  return (
    <div className={cn('nimi-statistic-group grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3', className)}>
      {children}
    </div>
  );
}
