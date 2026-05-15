import React, { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../design-tokens.js';

type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  showValue?: boolean;
};

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  {
    className,
    value,
    defaultValue,
    min = 0,
    max = 100,
    showValue = false,
    ...rest
  },
  ref,
) {
  const visibleValue = value ?? defaultValue ?? min;
  return (
    <label className={cn('nimi-slider flex min-w-0 items-center gap-3', className)}>
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        value={value}
        defaultValue={defaultValue}
        className="nimi-slider__input h-2 min-w-0 flex-1 cursor-pointer accent-[var(--nimi-action-primary-bg)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]"
        {...rest}
      />
      {showValue ? <span className="nimi-slider__value min-w-8 text-right text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">{visibleValue}</span> : null}
    </label>
  );
});
