import type { CSSProperties, ReactNode } from 'react';

export type ChatComposerShellProps = {
  children: ReactNode;
  height?: number | string;
  className?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

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
