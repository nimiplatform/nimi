import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../design-tokens.js';
import { NimiText } from './typography.js';

const layoutVariants = cva(
  'nimi-page-detail-layout mx-auto min-h-full px-6 pb-6 pt-[72px]',
  {
    variants: {
      width: {
        md: 'nimi-page-detail-layout--width-md max-w-3xl',
        lg: 'nimi-page-detail-layout--width-lg max-w-4xl',
      },
    },
    defaultVariants: { width: 'lg' },
  },
);

export type PageDetailLayoutWidth = NonNullable<VariantProps<typeof layoutVariants>['width']>;

export type PageDetailLayoutProps = {
  title: ReactNode;
  width?: PageDetailLayoutWidth;
  back?: ReactNode;
  actions?: ReactNode;
  subnav?: ReactNode;
  beforeContent?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function PageDetailLayout({
  title,
  width = 'lg',
  back,
  actions,
  subnav,
  beforeContent,
  children,
  className,
}: PageDetailLayoutProps) {
  return (
    <div className={cn(layoutVariants({ width }), className)}>
      {back ? (
        <div className="nimi-page-detail-layout__back-row mb-3 flex items-center gap-2">{back}</div>
      ) : null}
      <header className="nimi-page-detail-layout__header mb-5 flex flex-wrap items-end justify-between gap-4">
        <NimiText role="page-title" className="nimi-page-detail-layout__title m-0">
          {title}
        </NimiText>
        {actions ? (
          <div className="nimi-page-detail-layout__actions flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </header>
      {subnav ? <div className="nimi-page-detail-layout__subnav mb-4">{subnav}</div> : null}
      {beforeContent ? (
        <div className="nimi-page-detail-layout__before-content mb-4">{beforeContent}</div>
      ) : null}
      <div className="nimi-page-detail-layout__body">{children}</div>
    </div>
  );
}

export type BackLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  asChild?: boolean;
};

export const BackLink = forwardRef<HTMLAnchorElement, BackLinkProps>(function BackLink(
  { asChild = false, className, children, ...rest },
  ref,
) {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp
      ref={ref}
      className={cn(
        'nimi-back-link inline-flex items-center gap-1.5 text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-muted)] hover:underline',
        className,
      )}
      {...rest}
    >
      <svg
        className="nimi-back-link__icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      <Slottable>{children}</Slottable>
    </Comp>
  );
});
