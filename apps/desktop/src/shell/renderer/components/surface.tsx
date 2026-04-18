import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';
import { Surface, cn } from './design-tokens.js';

export type DesktopCardSurfaceKind = 'promoted-glass' | 'operational-solid';

const DESKTOP_CARD_SURFACE_CLASS: Record<DesktopCardSurfaceKind, string> = {
  'promoted-glass': 'rounded-2xl border-white/60 bg-[var(--nimi-surface-card-promoted-glass-elevated)] shadow-[0_14px_34px_rgba(15,23,42,0.05)]',
  'operational-solid': 'rounded-2xl border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-card-operational-solid-elevated)] shadow-[0_10px_22px_rgba(15,23,42,0.04)]',
};

type DesktopCardSurfaceProps = {
  kind?: DesktopCardSurfaceKind;
  as?: ElementType;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  interactive?: boolean;
  active?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'className' | 'style'>;

export function DesktopCardSurface(props: DesktopCardSurfaceProps) {
  const {
    kind = 'operational-solid',
    as = 'section',
    children,
    className,
    style,
    interactive = false,
    active = false,
    ...domProps
  } = props;

  return (
    <Surface
      {...domProps}
      as={as}
      tone="card"
      material={kind === 'promoted-glass' ? 'glass-regular' : 'solid'}
      elevation="base"
      padding="none"
      interactive={interactive}
      active={active}
      data-desktop-card-surface={kind}
      className={cn(DESKTOP_CARD_SURFACE_CLASS[kind], className)}
      style={style}
    >
      {children}
    </Surface>
  );
}
