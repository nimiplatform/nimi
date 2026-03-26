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
  return (
    <label
      className={cn(
        'flex rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-[var(--nimi-field-text)] transition-colors duration-[var(--nimi-motion-fast)] focus-within:border-[var(--nimi-field-focus)] focus-within:ring-[length:var(--nimi-focus-ring-width)] focus-within:ring-[var(--nimi-focus-ring-color)]',
        tone === 'quiet' && 'border-transparent bg-transparent',
        className,
      )}
    >
      <textarea
        ref={ref}
        className={cn(
          'min-h-[var(--nimi-sizing-textarea-min-height)] w-full resize-y bg-transparent px-3 py-2 outline-none placeholder:text-[var(--nimi-field-placeholder)]',
          textareaClassName,
        )}
        {...rest}
      />
    </label>
  );
});
