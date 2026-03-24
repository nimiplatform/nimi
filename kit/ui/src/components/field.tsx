import React, { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { FIELD_SLOT_CLASS, FIELD_TONE_CLASS, cx, type FieldTone } from '../design-tokens.js';

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  tone?: FieldTone;
  leading?: ReactNode;
  trailing?: ReactNode;
  inputClassName?: string;
};

type TextareaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  tone?: FieldTone;
  textareaClassName?: string;
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
    <label className={cx('nimi-field', FIELD_TONE_CLASS[tone], className)}>
      {leading ? <span className="shrink-0 text-[color:var(--nimi-text-muted)]">{leading}</span> : null}
      <input ref={ref} className={cx(FIELD_SLOT_CLASS.input, inputClassName)} {...rest} />
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

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { tone = 'default', className, textareaClassName, ...rest },
  ref,
) {
  return (
    <label className={cx('nimi-field nimi-field--textarea', FIELD_TONE_CLASS[tone], className)}>
      <textarea ref={ref} className={cx(FIELD_SLOT_CLASS.textarea, textareaClassName)} {...rest} />
    </label>
  );
});
