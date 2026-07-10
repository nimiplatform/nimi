import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/kit/ui';

const MAX_WIDTH_CLASS: Record<string, string> = {
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  full: '',
};

export function RuntimePageShell({
  children,
  maxWidth = '5xl',
  className,
}: {
  children: ReactNode;
  maxWidth?: '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | 'full';
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full min-w-0 overflow-x-hidden space-y-4 px-4 py-4', MAX_WIDTH_CLASS[maxWidth], className)}>
      {children}
    </div>
  );
}
