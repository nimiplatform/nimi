import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { SURFACE_ELEVATION_CLASS, SURFACE_TONE_CLASS, cx, type SurfaceElevation, type SurfaceTone } from './design-tokens.js';

type SurfacePadding = 'none' | 'sm' | 'md' | 'lg';

const SURFACE_PADDING_CLASS: Record<SurfacePadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

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

export function Surface<T extends ElementType = 'div'>(
  props: SurfaceProps<T>,
) {
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
      className: cx(
        'nimi-surface',
        SURFACE_TONE_CLASS[tone],
        SURFACE_ELEVATION_CLASS[elevation],
        SURFACE_PADDING_CLASS[padding],
        interactive && 'nimi-surface--interactive',
        active && 'nimi-surface--active',
        className,
      ),
      ...rest,
    },
    children,
  );
}
