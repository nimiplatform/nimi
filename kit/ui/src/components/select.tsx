import React, { forwardRef, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn, type FieldTone } from '../design-tokens.js';

export type SelectFieldOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectFieldChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

export type SelectFieldProps = {
  tone?: FieldTone;
  options: SelectFieldOption[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  open?: boolean;
  className?: string;
  selectClassName?: string;
  contentClassName?: string;
  onValueChange?: (value: string) => void;
  onChange?: (event: SelectFieldChangeEvent) => void;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
};

const CHEVRON_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function fieldToneClassName(tone: FieldTone) {
  if (tone === 'search') {
    return 'rounded-[var(--nimi-radius-full)]';
  }
  if (tone === 'quiet') {
    return 'border-transparent bg-transparent shadow-none';
  }
  return '';
}

function createChangeEvent(value: string): SelectFieldChangeEvent {
  return {
    target: { value },
    currentTarget: { value },
  };
}

export const SelectField = forwardRef<HTMLButtonElement, SelectFieldProps>(function SelectField(
  {
    tone = 'default',
    options,
    value,
    defaultValue,
    placeholder,
    disabled = false,
    required,
    name,
    open,
    className,
    selectClassName,
    contentClassName,
    onValueChange,
    onChange,
    onOpenChange,
    id,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'data-testid': dataTestId,
  },
  ref,
) {
  const handleValueChange = (nextValue: string) => {
    onValueChange?.(nextValue);
    onChange?.(createChangeEvent(nextValue));
  };

  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      required={required}
      name={name}
      open={open}
      onOpenChange={onOpenChange}
      onValueChange={handleValueChange}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-testid={dataTestId}
        className={cn(
          'flex min-h-[var(--nimi-sizing-field-md-height)] w-full items-center justify-between gap-2 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-left text-[var(--nimi-field-text)] transition-colors duration-[var(--nimi-motion-fast)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
          fieldToneClassName(tone),
          className,
          selectClassName,
        )}
      >
        <SelectPrimitive.Value
          placeholder={placeholder}
          className="min-w-0 flex-1 truncate text-sm"
        />
        <SelectPrimitive.Icon asChild>
          <span className="shrink-0 text-[var(--nimi-text-muted)]">{CHEVRON_ICON}</span>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            'z-[var(--nimi-z-popover)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-floating)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex min-h-9 cursor-pointer select-none items-center rounded-[var(--nimi-radius-sm)] py-2 pr-8 pl-3 text-sm text-[var(--nimi-text-primary)] outline-none',
                  'data-[highlighted]:bg-[var(--nimi-action-ghost-hover)] data-[highlighted]:text-[var(--nimi-text-primary)]',
                  'data-[state=checked]:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-[var(--nimi-opacity-disabled)]',
                )}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex items-center justify-center text-[var(--nimi-action-primary-bg)]">
                  {CHECK_ICON}
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});
