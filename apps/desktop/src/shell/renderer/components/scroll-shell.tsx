import type { HTMLAttributes } from 'react';
import { cn } from '@nimiplatform/kit/ui';

export type ScrollShellProps = HTMLAttributes<HTMLDivElement>;

export function ScrollShell({ className, ...props }: ScrollShellProps) {
  return (
    <div
      {...props}
      className={cn('min-h-0 overflow-y-auto overscroll-contain', className)}
    />
  );
}
