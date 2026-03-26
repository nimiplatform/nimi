import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

export type ChatThreadHeaderProps = {
  title: ReactNode;
  onTitleClick?: () => void;
  titleAriaLabel?: string;
  className?: string;
  titleClassName?: string;
  actions?: ReactNode;
};

export function ChatThreadHeader({
  title,
  onTitleClick,
  titleAriaLabel,
  className,
  titleClassName,
  actions,
}: ChatThreadHeaderProps) {
  return (
    <header className={cn('flex h-14 shrink-0 items-center justify-between bg-[var(--nimi-surface-canvas)] px-4', className)}>
      {onTitleClick ? (
        <button
          type="button"
          onClick={onTitleClick}
          aria-label={titleAriaLabel}
          className={cn(
            'text-[15px] font-semibold text-[var(--nimi-text-primary)] transition-colors hover:text-[var(--nimi-text-secondary)]',
            titleClassName,
          )}
        >
          {title}
        </button>
      ) : (
        <div className={cn('text-[15px] font-semibold text-[var(--nimi-text-primary)]', titleClassName)}>
          {title}
        </div>
      )}
      {actions ? <div className="ml-3 flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
