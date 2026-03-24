import type { ReactNode } from 'react';

export type ChatThreadHeaderProps = {
  title: ReactNode;
  onTitleClick?: () => void;
  titleAriaLabel?: string;
  className?: string;
  titleClassName?: string;
  actions?: ReactNode;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function ChatThreadHeader({
  title,
  onTitleClick,
  titleAriaLabel,
  className,
  titleClassName,
  actions,
}: ChatThreadHeaderProps) {
  return (
    <header className={cn('flex h-14 shrink-0 items-center justify-between bg-white px-4', className)}>
      {onTitleClick ? (
        <button
          type="button"
          onClick={onTitleClick}
          aria-label={titleAriaLabel}
          className={cn('text-[15px] font-semibold text-gray-900 transition-colors hover:text-gray-700', titleClassName)}
        >
          {title}
        </button>
      ) : (
        <div className={cn('text-[15px] font-semibold text-gray-900', titleClassName)}>
          {title}
        </div>
      )}
      {actions ? <div className="ml-3 flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
