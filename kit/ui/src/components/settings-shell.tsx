import React, { type CSSProperties, type ReactNode } from 'react';
import { cn, type SurfaceMaterial } from '../design-tokens.js';
import { ScrollArea } from './scroll-area.js';
import { Surface } from './surface.js';

export function SettingsCard({
  children,
  className,
  style,
  material = 'glass-thin',
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  material?: SurfaceMaterial;
}) {
  return (
    <Surface
      tone="card"
      padding="none"
      material={material}
      className={className}
      style={style}
    >
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
        className={cn('flex-1 bg-transparent', scrollClassName)}
        viewportClassName={cn('bg-transparent', viewportClassName)}
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
      <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{children}</h3>
      {description ? (
        <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{description}</p>
      ) : null}
    </div>
  );
}
