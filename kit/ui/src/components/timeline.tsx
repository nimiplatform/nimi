import { type ReactNode } from 'react';
import { cn, type StatusTone } from '../design-tokens.js';

export type TimelineProps = {
  children: ReactNode;
  className?: string;
};

export function Timeline({ children, className }: TimelineProps) {
  return (
    <div className={cn('nimi-timeline relative pl-[22px]', className)}>
      <div
        aria-hidden="true"
        className="nimi-timeline__rail absolute bottom-[6px] left-[6px] top-[6px] w-px bg-[linear-gradient(to_bottom,var(--nimi-border-subtle),var(--nimi-border-subtle)_80%,transparent)]"
      />
      {children}
    </div>
  );
}

/** Accent tone is `'primary'`; `'brand'` is a deprecated alias for it. */
export type TimelineDotTone = 'primary' | 'brand' | StatusTone;
export type TimelineDotVariant = 'solid' | 'dashed' | 'ring';
export type TimelineGroupVariant = 'past' | 'future';

type TimelineDotCanonicalTone = 'primary' | StatusTone;

// @deprecated legacy tone alias: 'brand' → 'primary'.
function normalizeTimelineDotTone(tone: TimelineDotTone): TimelineDotCanonicalTone {
  return tone === 'brand' ? 'primary' : tone;
}

const dotToneBorderClass: Record<TimelineDotCanonicalTone, string> = {
  primary: 'border-[var(--nimi-action-primary-bg)]',
  neutral: 'border-[var(--nimi-status-neutral)]',
  success: 'border-[var(--nimi-status-success)]',
  warning: 'border-[var(--nimi-status-warning)]',
  danger: 'border-[var(--nimi-status-danger)]',
  info: 'border-[var(--nimi-status-info)]',
};

const dotToneFillClass: Record<TimelineDotCanonicalTone, string> = {
  primary: 'bg-[var(--nimi-action-primary-bg)]',
  neutral: 'bg-[var(--nimi-status-neutral)]',
  success: 'bg-[var(--nimi-status-success)]',
  warning: 'bg-[var(--nimi-status-warning)]',
  danger: 'bg-[var(--nimi-status-danger)]',
  info: 'bg-[var(--nimi-status-info)]',
};

export type TimelineGroupProps = {
  /** Date label rendered as the group header. Omit to suppress the header row entirely (use for single-card groups whose card body already shows the date). */
  date?: ReactNode;
  secondaryLabel?: ReactNode;
  variant?: TimelineGroupVariant;
  dotVariant?: TimelineDotVariant;
  tone?: TimelineDotTone;
  isLast?: boolean;
  children: ReactNode;
  className?: string;
};

export function TimelineGroup({
  date,
  secondaryLabel,
  variant = 'past',
  dotVariant,
  tone = 'primary',
  isLast = false,
  children,
  className,
}: TimelineGroupProps) {
  const effectiveDotVariant: TimelineDotVariant =
    dotVariant ?? (variant === 'future' ? 'dashed' : 'solid');
  const canonicalTone = normalizeTimelineDotTone(tone);
  return (
    <div
      className={cn(
        'nimi-timeline-group relative',
        variant === 'future' && 'nimi-timeline-group--future',
        variant === 'past' && 'nimi-timeline-group--past',
        !isLast && 'mb-6',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'nimi-timeline-group__dot absolute -left-[22px] top-1 h-[13px] w-[13px] rounded-full',
          effectiveDotVariant === 'ring' && 'nimi-timeline-group__dot--ring grid place-items-center',
          effectiveDotVariant !== 'ring' &&
            'bg-[var(--nimi-surface-card)] shadow-[0_0_0_3px_var(--nimi-surface-card)]',
          effectiveDotVariant === 'solid' &&
            cn('nimi-timeline-group__dot--solid border-2 border-solid', dotToneBorderClass[canonicalTone]),
          effectiveDotVariant === 'dashed' &&
            cn('nimi-timeline-group__dot--dashed border-[1.5px] border-dashed', dotToneBorderClass[canonicalTone]),
          effectiveDotVariant === 'ring' &&
            cn('border-2 border-solid bg-[var(--nimi-surface-card)]', dotToneBorderClass[canonicalTone]),
        )}
      >
        {effectiveDotVariant === 'ring' ? (
          <span
            aria-hidden="true"
            className={cn('nimi-timeline-group__dot-core h-1.5 w-1.5 rounded-full', dotToneFillClass[canonicalTone])}
          />
        ) : null}
      </span>
      {date || secondaryLabel ? (
        <div className="nimi-timeline-group__header mb-2.5 flex items-baseline gap-2">
          {date ? (
            <span className="nimi-timeline-group__date text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">
              {date}
            </span>
          ) : null}
          {secondaryLabel ? (
            <span className="nimi-timeline-group__secondary font-mono text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">
              {secondaryLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="nimi-timeline-group__body flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

export type TimelineDividerProps = {
  label: ReactNode;
  className?: string;
};

export function TimelineDivider({ label, className }: TimelineDividerProps) {
  return (
    <div
      role="separator"
      aria-label={typeof label === 'string' ? label : undefined}
      className={cn(
        'nimi-timeline-divider mb-[18px] mt-[6px] flex items-center gap-3 text-[length:var(--nimi-type-overline-size)] uppercase tracking-[var(--nimi-type-overline-letter-spacing)] text-[var(--nimi-text-muted)]',
        className,
      )}
    >
      <span aria-hidden="true" className="nimi-timeline-divider__rule h-px flex-1 bg-[var(--nimi-border-subtle)]" />
      <span className="nimi-timeline-divider__label">{label}</span>
      <span aria-hidden="true" className="nimi-timeline-divider__rule h-px flex-1 bg-[var(--nimi-border-subtle)]" />
    </div>
  );
}
