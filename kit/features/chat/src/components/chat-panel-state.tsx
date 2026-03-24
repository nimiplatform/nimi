import type { ReactNode } from 'react';

export type ChatPanelStateProps = {
  children: ReactNode;
  activeChatId?: string | null;
  dataTestId?: string;
  tone?: 'default' | 'error';
  className?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

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
        tone === 'error' ? 'text-sm text-red-600' : 'text-sm text-gray-500',
        className,
      )}
    >
      {children}
    </section>
  );
}
