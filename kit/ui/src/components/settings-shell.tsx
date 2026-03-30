import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { ScrollArea } from './scroll-area.js';
import { Surface } from './surface.js';

export function SettingsCard({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Surface tone="card" padding="none" className={className} style={style}>
      {children}
    </Surface>
  );
}

export function SettingsPageShell({
  children,
  footer,
  className,
  scrollClassName,
  viewportClassName,
  contentClassName,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  scrollClassName?: string;
  viewportClassName?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <ScrollArea
        className={cn('flex-1 bg-[#F8F9FB]', scrollClassName)}
        viewportClassName={cn('bg-[#F8F9FB]', viewportClassName)}
      >
        <div className={cn('mx-auto flex max-w-2xl flex-col gap-6 px-6 py-6', contentClassName)}>
          {children}
        </div>
      </ScrollArea>
      {footer}
    </div>
  );
}

export function SettingsSectionTitle({
  children,
  description,
  className,
}: {
  children: ReactNode;
  description?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-gray-900">{children}</h3>
      {description ? <p className="mt-0.5 text-xs text-gray-500">{description}</p> : null}
    </div>
  );
}
