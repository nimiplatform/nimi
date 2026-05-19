import React, { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn, type FieldTone } from '../design-tokens.js';

type TextareaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  tone?: FieldTone;
  textareaClassName?: string;
};

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { tone = 'default', className, textareaClassName, ...rest },
  ref,
) {
  // Per P-DESIGN-015: tone="danger" auto-sets aria-invalid="true" on the inner control.
  // Explicit caller value always wins.
  const callerAriaInvalid = rest['aria-invalid'];
  const resolvedAriaInvalid = callerAriaInvalid !== undefined
    ? callerAriaInvalid
    : tone === 'danger' ? true : undefined;
  const { 'aria-invalid': _omitAriaInvalid, ...textareaRest } = rest;

  return (
    <label
      className={cn(
        'flex rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-[var(--nimi-field-text)] transition-colors duration-[var(--nimi-motion-fast)] focus-within:border-[var(--nimi-field-focus)] focus-within:ring-[length:var(--nimi-focus-ring-width)] focus-within:ring-[var(--nimi-focus-ring-color)]',
        tone === 'quiet' && 'border-transparent bg-transparent',
        tone === 'danger' && 'nimi-field--danger border-[var(--nimi-status-danger)] focus-within:border-[var(--nimi-status-danger)] focus-within:ring-[var(--nimi-status-danger)]',
        className,
      )}
    >
      <textarea
        ref={ref}
        aria-invalid={resolvedAriaInvalid}
        className={cn(
          'min-h-[var(--nimi-sizing-textarea-min-height)] w-full resize-y bg-transparent px-3 py-2 outline-none placeholder:text-[var(--nimi-field-placeholder)]',
          textareaClassName,
        )}
        {...textareaRest}
      />
    </label>
  );
});
