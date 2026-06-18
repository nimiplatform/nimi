import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '../design-tokens.js';

export type BreadcrumbItem = {
  id: string;
  label: ReactNode;
  href?: string;
  onClick?: () => void;
};

export type BreadcrumbProps = {
  items: BreadcrumbItem[];
  ariaLabel?: string;
  className?: string;
};

export function Breadcrumb({
  items,
  ariaLabel = 'Breadcrumb',
  className,
}: BreadcrumbProps) {
  return (
    <nav className={cn('nimi-breadcrumb min-w-0', className)} aria-label={ariaLabel}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const content = item.href ? (
            <a className="nimi-breadcrumb__link rounded-[var(--nimi-radius-sm)] px-1 text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]" href={item.href} onClick={item.onClick}>
              {item.label}
            </a>
          ) : item.onClick && !isLast ? (
            <button type="button" className="nimi-breadcrumb__link rounded-[var(--nimi-radius-sm)] px-1 text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]" onClick={item.onClick}>
              {item.label}
            </button>
          ) : (
            <span className="nimi-breadcrumb__current px-1 font-semibold text-[var(--nimi-text-primary)]" aria-current={isLast ? 'page' : undefined}>
              {item.label}
            </span>
          );

          return (
            <li key={item.id} className="nimi-breadcrumb__item inline-flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="nimi-breadcrumb__separator shrink-0 text-[var(--nimi-text-muted)]" size={13} aria-hidden="true" /> : null}
              {content}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
