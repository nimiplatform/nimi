import React, { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn, type FieldTone } from '../design-tokens.js';

const fieldVariants = cva(
  'flex items-center gap-2 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-[var(--nimi-field-text)] min-h-[var(--nimi-sizing-field-md-height)] transition-colors duration-[var(--nimi-motion-fast)] focus-within:border-[var(--nimi-field-focus)] focus-within:ring-[length:var(--nimi-focus-ring-width)] focus-within:ring-[var(--nimi-focus-ring-color)]',
  {
    variants: {
      tone: {
        default: 'px-3',
        search: 'px-3 rounded-[var(--nimi-radius-full)]',
        quiet: 'border-transparent bg-transparent px-0',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  tone?: FieldTone;
  leading?: ReactNode;
  trailing?: ReactNode;
  inputClassName?: string;
};

const SEARCH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    tone = 'default',
    leading,
    trailing,
    className,
    inputClassName,
    ...rest
  },
  ref,
) {
  return (
    <label className={cn(fieldVariants({ tone }), className)}>
      {leading ? <span className="shrink-0 text-[var(--nimi-text-muted)]">{leading}</span> : null}
      <input
        ref={ref}
        className={cn(
          'min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--nimi-field-placeholder)]',
          inputClassName,
        )}
        {...rest}
      />
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </label>
  );
});

export const SearchField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'tone' | 'leading'>>(function SearchField(
  props,
  ref,
) {
  return <TextField ref={ref} tone="search" leading={SEARCH_ICON} {...props} />;
});
