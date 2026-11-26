import React from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';

type NumberStepperProps = {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  /** Accessible label for the decrement button. Defaults to `Decrease ${ariaLabel}`. */
  decreaseLabel?: string;
  /** Accessible label for the increment button. Defaults to `Increase ${ariaLabel}`. */
  increaseLabel?: string;
};

export function NumberStepper({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  ariaLabel,
  className,
  disabled = false,
  decreaseLabel,
  increaseLabel,
}: NumberStepperProps) {
  const clamp = (next: number) => Math.min(max ?? next, Math.max(min ?? next, next));
  const decrementDisabled = disabled || (min !== undefined && value <= min);
  const incrementDisabled = disabled || (max !== undefined && value >= max);

  return (
    <div className={cn('nimi-number-stepper inline-flex min-h-[var(--nimi-sizing-field-md-height)] items-stretch rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-[var(--nimi-field-text)]', className)}>
      <button
        type="button"
        className={cn(
          'nimi-number-stepper__button inline-flex min-w-9 self-stretch items-center justify-center rounded-l-[var(--nimi-radius-field)] border-r border-[var(--nimi-border-subtle)] text-[var(--nimi-text-secondary)] transition-[background-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-ghost-hover)] active:bg-[var(--nimi-surface-active)] active:scale-[var(--nimi-motion-pressed-scale)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
          FOCUS_RING_CLASS_NAME,
          'focus-visible:ring-inset',
        )}
        aria-label={decreaseLabel ?? `Decrease ${ariaLabel}`}
        disabled={decrementDisabled}
        onClick={() => onValueChange(clamp(value - step))}
      >
        −
      </button>
      <output className="nimi-number-stepper__value flex min-w-12 items-center justify-center px-3 text-center tabular-nums text-[length:var(--nimi-type-label-size)] font-medium" aria-label={ariaLabel}>
        {value}
      </output>
      <button
        type="button"
        className={cn(
          'nimi-number-stepper__button inline-flex min-w-9 self-stretch items-center justify-center rounded-r-[var(--nimi-radius-field)] border-l border-[var(--nimi-border-subtle)] text-[var(--nimi-text-secondary)] transition-[background-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-ghost-hover)] active:bg-[var(--nimi-surface-active)] active:scale-[var(--nimi-motion-pressed-scale)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
          FOCUS_RING_CLASS_NAME,
          'focus-visible:ring-inset',
        )}
        aria-label={increaseLabel ?? `Increase ${ariaLabel}`}
        disabled={incrementDisabled}
        onClick={() => onValueChange(clamp(value + step))}
      >
        +
      </button>
    </div>
  );
}
