import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

export type ChatComposerShellProps = {
  children: ReactNode;
  height?: number | string;
  className?: string;
};

export function ChatComposerShell({
  children,
  height,
  className,
}: ChatComposerShellProps) {
  const style: CSSProperties | undefined = height == null
    ? undefined
    : { height: typeof height === 'number' ? `${height}px` : height };

  return (
    <div className={cn('shrink-0', className)} style={style}>
      {children}
    </div>
  );
}
