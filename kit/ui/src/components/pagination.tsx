import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';
import { IconButton } from './button.js';

export type PaginationProps = {
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  ariaLabel?: string;
  className?: string;
};

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(page, 1), Math.max(pageCount, 1));
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  ariaLabel = 'Pagination',
  className,
}: PaginationProps) {
  const current = clampPage(page, pageCount);
  const total = Math.max(pageCount, 1);
  const pages = Array.from({ length: total }, (_, index) => index + 1).filter((candidate) => (
    candidate === 1 ||
    candidate === total ||
    Math.abs(candidate - current) <= 1
  ));

  return (
    <nav className={cn('nimi-pagination inline-flex items-center gap-1', className)} aria-label={ariaLabel}>
      <IconButton
        size="sm"
        tone="ghost"
        icon={<ChevronLeft size={14} />}
        aria-label="Previous page"
        disabled={current <= 1}
        onClick={() => onPageChange?.(clampPage(current - 1, total))}
      />
      {pages.map((candidate, index) => {
        const previous = pages[index - 1];
        const needsGap = previous && candidate - previous > 1;
        return (
          <span key={candidate} className="inline-flex items-center gap-1">
            {needsGap ? <span className="nimi-pagination__ellipsis px-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]" aria-hidden="true">...</span> : null}
            <button
              type="button"
              className={cn(
                'nimi-pagination__page grid h-8 min-w-8 place-items-center rounded-[var(--nimi-radius-sm)] border px-2 text-[length:var(--nimi-type-body-size)] font-semibold transition-colors duration-[var(--nimi-motion-fast)]',
                FOCUS_RING_CLASS_NAME,
                candidate === current
                  ? 'nimi-pagination__page--active border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)] text-[var(--nimi-text-primary)]'
                  : 'border-transparent text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)]',
              )}
              aria-current={candidate === current ? 'page' : undefined}
              onClick={() => onPageChange?.(candidate)}
            >
              {candidate}
            </button>
          </span>
        );
      })}
      <IconButton
        size="sm"
        tone="ghost"
        icon={<ChevronRight size={14} />}
        aria-label="Next page"
        disabled={current >= total}
        onClick={() => onPageChange?.(clampPage(current + 1, total))}
      />
    </nav>
  );
}
