import React, { type CSSProperties, type ReactNode } from 'react';
import { Surface, cn } from '@nimiplatform/kit/ui';

export type ConversationComposerShellProps = {
  children: ReactNode;
  height?: number | string;
  className?: string;
};

/**
 * Visual container for the conversation composer.
 * Provides the frosted-glass card styling used by canonical chat surfaces.
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
    <Surface
      material="glass-chrome"
      tone="card"
      elevation="floating"
      padding="none"
      className={cn(
        'shrink-0 rounded-[var(--nimi-radius-xl)]',
        'px-2.5 py-1.5',
        className,
      )}
      style={style}
    >
      {children}
    </Surface>
  );
}
