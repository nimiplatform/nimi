import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';

export type DashedAddButtonShape = 'tile' | 'row' | 'thumb' | 'dropzone';

type DashedAddButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  shape?: DashedAddButtonShape;
  active?: boolean;
  icon?: ReactNode;
  label?: ReactNode;
  description?: ReactNode;
};

const SHAPE_LAYOUT: Record<DashedAddButtonShape, string> = {
  tile: 'flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-[var(--nimi-radius-lg)]',
  row: 'flex w-full items-center justify-center gap-2 rounded-[var(--nimi-radius-md)] py-3 text-[length:var(--nimi-type-body-sm-size)] font-medium',
  thumb: 'flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-[var(--nimi-radius-md)]',
  dropzone: 'flex w-full flex-col items-center justify-center gap-2 rounded-[var(--nimi-radius-lg)] py-10',
};

const SHAPE_ICON_SIZE: Record<DashedAddButtonShape, number> = {
  tile: 22,
  row: 16,
  thumb: 18,
  dropzone: 28,
};

function PlusIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      className={cn(
        'transition-transform duration-[var(--nimi-motion-slow)] ease-[var(--nimi-motion-ease-standard)] motion-reduce:transition-none group-hover:motion-safe:scale-110 group-hover:motion-safe:rotate-90',
        active && 'motion-safe:scale-110 motion-safe:rotate-90',
      )}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export const DashedAddButton = forwardRef<HTMLButtonElement, DashedAddButtonProps>(function DashedAddButton(
  {
    shape = 'tile',
    active = false,
    icon,
    label,
    description,
    className,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isActive = !disabled && active;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      data-active={isActive || undefined}
      className={cn(
        'nimi-dashed-add-button group border-2 border-dashed transition-[background-color,border-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] enabled:active:scale-[var(--nimi-motion-pressed-scale)]',
        FOCUS_RING_CLASS_NAME,
        SHAPE_LAYOUT[shape],
        isActive
          ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]'
          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)] enabled:hover:border-[var(--nimi-action-primary-bg)] enabled:hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] enabled:hover:text-[var(--nimi-action-primary-bg)]',
        disabled && 'cursor-not-allowed opacity-[var(--nimi-opacity-disabled)]',
        className,
      )}
      {...rest}
    >
      {icon ?? <PlusIcon size={SHAPE_ICON_SIZE[shape]} active={isActive} />}
      {label ? (
        <span
          className={cn(
            'text-center',
            shape === 'tile' && 'px-1 text-[length:var(--nimi-type-caption-size)]',
            shape === 'row' && 'text-[length:var(--nimi-type-body-sm-size)] font-medium',
            shape === 'thumb' && 'text-[length:var(--nimi-type-overline-size)]',
            shape === 'dropzone' && 'text-[length:var(--nimi-type-body-size)] font-medium text-[var(--nimi-text-primary)]',
          )}
        >
          {label}
        </span>
      ) : null}
      {description ? (
        <span className="text-center text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">{description}</span>
      ) : null}
    </button>
  );
});
