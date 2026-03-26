import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

export type ChatPanelStateProps = {
  children: ReactNode;
  activeChatId?: string | null;
  dataTestId?: string;
  tone?: 'default' | 'error';
  className?: string;
};

export function ChatPanelState({
  children,
  activeChatId,
  dataTestId,
  tone = 'default',
  className,
}: ChatPanelStateProps) {
  return (
    <section
      data-testid={dataTestId}
      data-active-chat-id={String(activeChatId || '')}
      className={cn(
        'flex h-full items-center justify-center',
        tone === 'error'
          ? 'text-sm text-[var(--nimi-status-danger)]'
          : 'text-sm text-[var(--nimi-text-muted)]',
        className,
      )}
    >
      {children}
    </section>
  );
}
