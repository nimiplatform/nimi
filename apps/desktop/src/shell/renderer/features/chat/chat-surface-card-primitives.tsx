import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { DesktopCardSurface } from '@renderer/components/surface';

export function ChatSurfaceCard(props: {
  children: ReactNode;
  className?: string;
  cardKey: 'primary' | 'status' | 'diagnostic' | 'settings';
}) {
  return (
    <DesktopCardSurface
      kind="promoted-glass"
      as="section"
      className={cn('min-h-0 overflow-hidden', props.className)}
      data-chat-surface-card={props.cardKey}
    >
      {props.children}
    </DesktopCardSurface>
  );
}

export function ChatSurfaceCardTitle(props: {
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
