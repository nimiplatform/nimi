import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn, type ActionSize, type ActionTone } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';

export const buttonVariants = cva(
  'nimi-action inline-flex max-w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap border font-semibold tracking-[var(--nimi-type-label-letter-spacing)] rounded-[var(--nimi-radius-action)] transition-all duration-[var(--nimi-motion-fast)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
  {
    variants: {
      tone: {
        primary:
          'nimi-action--primary bg-[var(--nimi-action-primary-bg)] border-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] hover:bg-[var(--nimi-action-primary-bg-hover)] hover:-translate-y-px',
        secondary:
          'nimi-action--secondary bg-[var(--nimi-action-secondary-bg)] border-[var(--nimi-action-secondary-border)] text-[var(--nimi-action-secondary-text)] hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-base)] hover:-translate-y-px',
        ghost:
          'nimi-action--ghost bg-transparent border-transparent text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] hover:-translate-y-px',
        danger:
          'nimi-action--danger bg-[var(--nimi-status-danger-soft-bg)] border-transparent text-[var(--nimi-status-danger-soft-text)] hover:-translate-y-px',
      },
      size: {
        sm: 'nimi-action--size-sm min-h-[var(--nimi-sizing-action-sm-height)] px-3 text-[length:var(--nimi-type-body-sm-size)]',
        md: 'nimi-action--size-md min-h-[var(--nimi-sizing-action-md-height)] px-4 text-[length:var(--nimi-type-label-size)]',
        lg: 'nimi-action--size-lg min-h-[var(--nimi-sizing-action-lg-height)] px-5 text-[length:var(--nimi-type-label-size)]',
      },
    },
    defaultVariants: {
      tone: 'secondary',
      size: 'md',
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  size?: ActionSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  active?: boolean;
  asChild?: boolean;
};

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  size?: ActionSize;
  icon: ReactNode;
  active?: boolean;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone = 'secondary',
    size = 'md',
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    loading = false,
    active = false,
    asChild = false,
    className,
    children,
    type = 'button',
    disabled,
    ...rest
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  const isDisabled = disabled || loading;
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      aria-busy={loading || undefined}
      data-active={active || undefined}
      disabled={asChild ? undefined : isDisabled}
      className={cn(
        buttonVariants({ tone, size }),
        FOCUS_RING_CLASS_NAME,
        active && 'nimi-action--active bg-[var(--nimi-surface-active)]',
        loading && 'nimi-action--loading cursor-wait',
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {leadingIcon ? <span className="nimi-action__leading inline-flex shrink-0 items-center justify-center">{leadingIcon}</span> : null}
      {loading ? <span className="nimi-action__spinner inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : null}
      <span className="inline-flex min-w-0 items-center justify-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap">{children}</span>
      {trailingIcon ? <span className="nimi-action__trailing inline-flex shrink-0 items-center justify-center">{trailingIcon}</span> : null}
    </Comp>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    tone = 'ghost',
    size = 'md',
    icon,
    active = false,
    asChild = false,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      className={cn(
        buttonVariants({ tone, size }),
        FOCUS_RING_CLASS_NAME,
        'nimi-action--icon aspect-square px-0',
        active && 'nimi-action--active bg-[var(--nimi-surface-active)]',
        className,
      )}
      {...rest}
    >
      <span className="nimi-action__icon inline-flex shrink-0 items-center justify-center">{icon}</span>
    </Comp>
  );
});
