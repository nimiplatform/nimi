import React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../design-tokens.js';

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function Toggle({ checked, onChange, disabled = false, className }: ToggleProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className={cn(
        'inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-[var(--nimi-motion-fast)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
        'data-[state=checked]:bg-[var(--nimi-action-primary-bg)] data-[state=unchecked]:bg-[var(--nimi-toggle-off-bg)]',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-[var(--nimi-motion-fast)] data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}
