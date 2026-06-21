import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type SurfaceElevation, type SurfaceMaterial, type SurfaceMaterialTransparency, type SurfaceTone } from '../design-tokens.js';
import { downgradeSurfaceMaterial } from '../glass/material.js';

type SurfacePadding = 'none' | 'sm' | 'md' | 'lg';

export const surfaceVariants = cva(
  'nimi-surface rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] transition-colors duration-[var(--nimi-motion-fast)]',
  {
    variants: {
      tone: {
        canvas: 'nimi-surface--canvas bg-[var(--nimi-surface-canvas)]',
        panel: 'nimi-surface--panel bg-[var(--nimi-surface-panel)]',
        card: 'nimi-surface--card bg-[var(--nimi-surface-card)]',
        hero: 'nimi-surface--hero bg-[image:var(--nimi-surface-hero)]',
        overlay: 'nimi-surface--overlay bg-[var(--nimi-surface-overlay)]',
      },
      elevation: {
        base: 'nimi-surface--elevation-base shadow-[var(--nimi-elevation-base)]',
        raised: 'nimi-surface--elevation-raised shadow-[var(--nimi-elevation-raised)]',
        floating: 'nimi-surface--elevation-floating shadow-[var(--nimi-elevation-floating)]',
        modal: 'nimi-surface--elevation-modal shadow-[var(--nimi-elevation-modal)]',
      },
      padding: {
        none: '',
        sm: 'p-3',
        md: 'p-4',
        lg: 'p-6',
      },
      material: {
        solid: 'nimi-material-solid',
        'glass-thin': 'nimi-material-glass-thin bg-[var(--nimi-material-glass-thin-bg)] border-[var(--nimi-material-glass-thin-border)] backdrop-blur-[var(--nimi-backdrop-blur-thin)]',
        'glass-regular': 'nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]',
        'glass-thick': 'nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border-[var(--nimi-material-glass-thick-border)] backdrop-blur-[var(--nimi-backdrop-blur-strong)]',
        'glass-chrome': 'nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)]',
      },
      transparency: {
        default: '',
        reduced: 'nimi-surface--transparency-reduced',
        solid: 'nimi-surface--transparency-solid',
      },
    },
    defaultVariants: {
      tone: 'panel',
      elevation: 'base',
      padding: 'md',
      material: 'solid',
      transparency: 'default',
    },
  },
);

// `downgradeSurfaceMaterial` moved to `../glass/material.ts` (wave-b
// fork F6 glass-primitive carve-out). Re-exported here so the public
// `kit/ui` barrel preserves the pre-wave-b export shape.
export { downgradeSurfaceMaterial } from '../glass/material.js';

type SurfaceProps<T extends ElementType = 'div'> = {
  as?: T;
  tone?: SurfaceTone;
  elevation?: SurfaceElevation;
  padding?: SurfacePadding;
  material?: SurfaceMaterial;
  transparency?: SurfaceMaterialTransparency;
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
    material = 'solid',
    transparency = 'default',
    interactive = false,
    active = false,
    children,
    className,
    ...rest
  } = props;
  const Component = (as || 'div') as ElementType;
  const resolvedMaterial = downgradeSurfaceMaterial(material, transparency);

  return createElement(
    Component,
    {
      ...rest,
      'data-nimi-material': resolvedMaterial,
      'data-nimi-requested-material': material,
      'data-nimi-transparency': transparency,
      'data-nimi-tone': tone,
      className: cn(
        surfaceVariants({ tone, elevation, padding, material: resolvedMaterial, transparency }),
        interactive && 'nimi-surface--interactive cursor-pointer hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]',
        active && 'nimi-surface--active border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]',
        className,
      ),
    },
    children,
  );
}
