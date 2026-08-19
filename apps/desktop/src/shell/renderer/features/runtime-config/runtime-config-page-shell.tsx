import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/kit/ui';

export function resetRuntimePageViewport(
  viewport: Pick<HTMLDivElement, 'scrollTo'> | null,
): void {
  viewport?.scrollTo({ top: 0, left: 0 });
}

// Single home for the runtime panel content width. Every runtime page uses
// this width; pixel values must not be redeclared per page.
export const RUNTIME_PAGE_WIDTH_CLASS = 'max-w-5xl';

export function RuntimePageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full min-w-0 overflow-x-hidden space-y-4 px-4 pb-4', RUNTIME_PAGE_WIDTH_CLASS, className)}>
      {children}
    </div>
  );
}

// Canonical runtime page header: one H1, optional one-line description,
// primary actions pinned to the title row's right end.
export function RuntimePageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-[color:var(--nimi-text-primary)]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-[var(--nimi-text-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
