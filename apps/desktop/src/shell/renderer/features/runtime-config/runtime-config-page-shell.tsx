import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

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
    <div className={cn('mx-auto w-full space-y-6 px-5 py-5', MAX_WIDTH_CLASS[maxWidth], className)}>
      {children}
    </div>
  );
}
