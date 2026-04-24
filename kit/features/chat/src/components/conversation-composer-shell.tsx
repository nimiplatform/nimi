import React, { type CSSProperties, type ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

export type ConversationComposerShellProps = {
  children: ReactNode;
  height?: number | string;
  className?: string;
};

/**
 * Visual container for the conversation composer.
 * Provides the frosted-glass card styling matching local-chat.
 * Does NOT include send button — that belongs to the inner ChatComposer.
 */
export function ConversationComposerShell({
  children,
  height,
  className,
}: ConversationComposerShellProps) {
  const style: CSSProperties | undefined = height == null
    ? undefined
    : { height: typeof height === 'number' ? `${height}px` : height };

  return (
    <div
      className={cn(
        'shrink-0 rounded-[28px]',
        'border border-white/90 bg-white/84',
        'shadow-[0_24px_50px_rgba(15,23,42,0.08)]',
        'backdrop-blur-xl',
        'px-3 py-2',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
