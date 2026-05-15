import React from 'react';
import { cn } from '../design-tokens.js';

type NumberStepperProps = {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
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
}: NumberStepperProps) {
  const clamp = (next: number) => Math.min(max ?? next, Math.max(min ?? next, next));
  const decrementDisabled = disabled || (min !== undefined && value <= min);
  const incrementDisabled = disabled || (max !== undefined && value >= max);

  return (
    <div className={cn('nimi-number-stepper inline-flex min-h-[var(--nimi-sizing-field-md-height)] items-center overflow-hidden rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-[var(--nimi-field-text)]', className)}>
      <button
        type="button"
        className="nimi-number-stepper__button inline-flex h-full min-w-9 items-center justify-center border-r border-[var(--nimi-border-subtle)] text-[var(--nimi-text-secondary)] transition-colors duration-[var(--nimi-motion-fast)] hover:bg-[var(--nimi-action-ghost-hover)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]"
        aria-label={`Decrease ${ariaLabel}`}
        disabled={decrementDisabled}
        onClick={() => onValueChange(clamp(value - step))}
      >
        -
      </button>
      <output className="nimi-number-stepper__value min-w-12 px-3 text-center text-[length:var(--nimi-type-label-size)] font-medium" aria-label={ariaLabel}>
        {value}
      </output>
      <button
        type="button"
        className="nimi-number-stepper__button inline-flex h-full min-w-9 items-center justify-center border-l border-[var(--nimi-border-subtle)] text-[var(--nimi-text-secondary)] transition-colors duration-[var(--nimi-motion-fast)] hover:bg-[var(--nimi-action-ghost-hover)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]"
        aria-label={`Increase ${ariaLabel}`}
        disabled={incrementDisabled}
        onClick={() => onValueChange(clamp(value + step))}
      >
        +
      </button>
    </div>
  );
}
