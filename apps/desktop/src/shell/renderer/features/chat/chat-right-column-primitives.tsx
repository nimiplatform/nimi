import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { DesktopCardSurface } from '@renderer/components/surface';

export function ChatRightColumn(props: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLElement>) {
  const { children, className, ...domProps } = props;
  return (
    <aside
      {...domProps}
      className={cn(
        'ml-2 flex min-h-0 w-[320px] shrink-0 flex-col gap-3',
        className,
      )}
      data-chat-right-column="true"
    >
      {children}
    </aside>
  );
}

export function ChatRightColumnCard(props: {
  children: ReactNode;
  className?: string;
  cardKey: 'primary' | 'status' | 'settings';
}) {
  return (
    <DesktopCardSurface
      kind="promoted-glass"
      as="section"
      className={cn('min-h-0 overflow-hidden', props.className)}
      data-chat-right-card={props.cardKey}
    >
      {props.children}
    </DesktopCardSurface>
  );
}

export function ChatRightColumnCardTitle(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', props.className)}>
      <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h2>
      {props.subtitle ? (
        <p className="text-xs leading-5 text-[var(--nimi-text-secondary)]">{props.subtitle}</p>
      ) : null}
    </div>
  );
}
