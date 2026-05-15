import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type TypographyRole } from '../design-tokens.js';

const defaultElementByRole: Record<TypographyRole, ElementType> = {
  'page-title': 'h1',
  'section-title': 'h2',
  'card-title': 'h3',
  body: 'p',
  helper: 'p',
  label: 'span',
  caption: 'span',
};

export const typographyVariants = cva('nimi-text min-w-0 text-[var(--nimi-text-primary)]', {
  variants: {
    role: {
      'page-title': 'nimi-text--page-title text-[length:var(--nimi-type-page-title-size)] leading-[var(--nimi-type-page-title-line-height)] font-[var(--nimi-type-page-title-weight)]',
      'section-title': 'nimi-text--section-title text-[length:var(--nimi-type-section-title-size)] leading-[var(--nimi-type-section-title-line-height)] font-[var(--nimi-type-section-title-weight)]',
      'card-title': 'nimi-text--card-title text-[length:var(--nimi-type-label-size)] leading-[var(--nimi-type-label-line-height)] font-[var(--nimi-type-label-weight)]',
      body: 'nimi-text--body text-[length:var(--nimi-type-body-size)] leading-[var(--nimi-type-body-line-height)] font-normal text-[var(--nimi-text-secondary)]',
      helper: 'nimi-text--helper text-[length:var(--nimi-type-body-sm-size)] leading-[var(--nimi-type-body-sm-line-height)] font-normal text-[var(--nimi-text-muted)]',
      label: 'nimi-text--label text-[length:var(--nimi-type-label-size)] leading-[var(--nimi-type-label-line-height)] font-medium text-[var(--nimi-text-secondary)]',
      caption: 'nimi-text--caption text-[length:var(--nimi-type-caption-size)] leading-[var(--nimi-type-caption-line-height)] font-medium text-[var(--nimi-text-muted)]',
    },
  },
  defaultVariants: {
    role: 'body',
  },
});

type NimiTextProps<T extends ElementType = 'p'> = {
  as?: T;
  role?: TypographyRole;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

export function NimiText<T extends ElementType = 'p'>({
  as,
  role = 'body',
  children,
  className,
  ...rest
}: NimiTextProps<T>) {
  const Component = (as || defaultElementByRole[role]) as ElementType;
  return createElement(
    Component,
    {
      ...rest,
      className: cn(typographyVariants({ role }), className),
    },
    children,
  );
}
