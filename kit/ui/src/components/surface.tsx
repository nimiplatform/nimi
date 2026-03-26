import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type SurfaceElevation, type SurfaceTone } from '../design-tokens.js';

type SurfacePadding = 'none' | 'sm' | 'md' | 'lg';

export const surfaceVariants = cva(
  'rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] transition-colors duration-[var(--nimi-motion-fast)]',
  {
    variants: {
      tone: {
        canvas: 'bg-[var(--nimi-surface-canvas)]',
        panel: 'bg-[var(--nimi-surface-panel)]',
        card: 'bg-[var(--nimi-surface-card)]',
        hero: 'bg-[image:var(--nimi-surface-hero)]',
        overlay: 'bg-[var(--nimi-surface-overlay)]',
      },
      elevation: {
        base: 'shadow-[var(--nimi-elevation-base)]',
        raised: 'shadow-[var(--nimi-elevation-raised)]',
        floating: 'shadow-[var(--nimi-elevation-floating)]',
        modal: 'shadow-[var(--nimi-elevation-modal)]',
      },
      padding: {
        none: '',
        sm: 'p-3',
        md: 'p-4',
        lg: 'p-6',
      },
    },
    defaultVariants: {
      tone: 'panel',
      elevation: 'base',
      padding: 'md',
    },
  },
);

type SurfaceProps<T extends ElementType = 'div'> = {
  as?: T;
  tone?: SurfaceTone;
  elevation?: SurfaceElevation;
  padding?: SurfacePadding;
  interactive?: boolean;
  active?: boolean;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

export function Surface<T extends ElementType = 'div'>(props: SurfaceProps<T>) {
  const {
    as,
    tone = 'panel',
    elevation = 'base',
    padding = 'md',
    interactive = false,
    active = false,
    children,
    className,
    ...rest
  } = props;
  const Component = (as || 'div') as ElementType;

  return createElement(
    Component,
    {
      className: cn(
        surfaceVariants({ tone, elevation, padding }),
        interactive && 'cursor-pointer hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]',
        active && 'bg-[var(--nimi-surface-active)]',
        className,
      ),
      ...rest,
    },
    children,
  );
}
