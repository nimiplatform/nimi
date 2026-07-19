import React, { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../design-tokens.js';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, checked, defaultChecked, disabled, ...rest },
  ref,
) {
  return (
    <label className={cn('nimi-checkbox inline-flex min-w-0 items-center gap-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]', disabled && 'opacity-[var(--nimi-opacity-disabled)]', className)}>
      <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          className="peer absolute inset-0 m-0 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          {...rest}
        />
        <span className="nimi-checkbox__box pointer-events-none inline-flex h-4 w-4 items-center justify-center rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-[var(--nimi-action-primary-text)] transition-[background-color,border-color,color] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] peer-checked:border-[var(--nimi-action-primary-bg)] peer-checked:bg-[var(--nimi-action-primary-bg)] peer-focus-visible:ring-[length:var(--nimi-focus-ring-width)] peer-focus-visible:ring-[var(--nimi-focus-ring-color)]">
          <span className="nimi-checkbox__indicator opacity-0 transition-opacity duration-[var(--nimi-motion-fast)] peer-checked:opacity-100">✓</span>
        </span>
      </span>
      {label ? <span className="truncate">{label}</span> : null}
    </label>
  );
});
