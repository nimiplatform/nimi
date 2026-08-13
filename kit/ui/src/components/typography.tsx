import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type TypographyRole } from '../design-tokens.js';

const defaultElementByRole: Record<TypographyRole, ElementType> = {
  'page-title': 'h1',
  'section-title': 'h2',
  'card-title': 'h3',
  'hero-title': 'h1',
  body: 'p',
  helper: 'p',
  label: 'span',
  caption: 'span',
};

// P-DESIGN-016: every role applies its token-driven letter-spacing and,
// where admitted, the CJK line-height/tracking profile via :lang(zh).
// font-optical-sizing stays on so size-specific optical adjustments apply.
export const typographyVariants = cva('nimi-text min-w-0 [font-optical-sizing:auto] text-[var(--nimi-text-primary)]', {
  variants: {
    role: {
      'page-title': 'nimi-text--page-title text-[length:var(--nimi-type-page-title-size)] leading-[var(--nimi-type-page-title-line-height)] font-[var(--nimi-type-page-title-weight)] tracking-[var(--nimi-type-page-title-letter-spacing)] [:lang(zh)]:tracking-[var(--nimi-type-page-title-cjk-letter-spacing)]',
      'section-title': 'nimi-text--section-title text-[length:var(--nimi-type-section-title-size)] leading-[var(--nimi-type-section-title-line-height)] font-[var(--nimi-type-section-title-weight)] tracking-[var(--nimi-type-section-title-letter-spacing)] [:lang(zh)]:leading-[var(--nimi-type-section-title-cjk-line-height)]',
      'card-title': 'nimi-text--card-title text-[length:var(--nimi-type-label-size)] leading-[var(--nimi-type-label-line-height)] font-[var(--nimi-type-label-weight)] tracking-[var(--nimi-type-label-letter-spacing)] [:lang(zh)]:leading-[var(--nimi-type-label-cjk-line-height)]',
      body: 'nimi-text--body text-[length:var(--nimi-type-body-size)] leading-[var(--nimi-type-body-line-height)] font-normal tracking-[var(--nimi-type-body-letter-spacing)] text-[var(--nimi-text-secondary)] [:lang(zh)]:leading-[var(--nimi-type-body-cjk-line-height)] [:lang(zh)]:tracking-[var(--nimi-type-body-cjk-letter-spacing)]',
      helper: 'nimi-text--helper text-[length:var(--nimi-type-body-sm-size)] leading-[var(--nimi-type-body-sm-line-height)] font-normal tracking-[var(--nimi-type-body-sm-letter-spacing)] text-[var(--nimi-text-muted)] [:lang(zh)]:leading-[var(--nimi-type-body-sm-cjk-line-height)] [:lang(zh)]:tracking-[var(--nimi-type-body-sm-cjk-letter-spacing)]',
      label: 'nimi-text--label text-[length:var(--nimi-type-label-size)] leading-[var(--nimi-type-label-line-height)] font-medium tracking-[var(--nimi-type-label-letter-spacing)] text-[var(--nimi-text-secondary)] [:lang(zh)]:leading-[var(--nimi-type-label-cjk-line-height)]',
      caption: 'nimi-text--caption text-[length:var(--nimi-type-caption-size)] leading-[var(--nimi-type-caption-line-height)] font-medium tracking-[var(--nimi-type-caption-letter-spacing)] text-[var(--nimi-text-muted)] [:lang(zh)]:leading-[var(--nimi-type-caption-cjk-line-height)]',
      'hero-title': 'nimi-text--hero-title text-[length:var(--nimi-type-hero-title-size)] leading-[var(--nimi-type-hero-title-line-height)] font-[var(--nimi-type-hero-title-weight)] tracking-[var(--nimi-type-hero-title-letter-spacing)] [:lang(zh)]:leading-[var(--nimi-type-hero-title-cjk-line-height)] [:lang(zh)]:tracking-[var(--nimi-type-hero-title-cjk-letter-spacing)]',
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

// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-016
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
