import React, { forwardRef, useState, useCallback, useRef, useEffect } from 'react';

/* ─── OtButton ─── */

interface OtButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'primary' | 'secondary' | 'tertiary' | 'icon';
  loading?: boolean;
}

export const OtButton = forwardRef<HTMLButtonElement, OtButtonProps>(
  ({ variant, loading, disabled, className, children, ...rest }, ref) => {
    const cls = `ot-btn-${variant}${className ? ` ${className}` : ''}`;
    return (
      <button ref={ref} className={cls} disabled={disabled || loading} {...rest}>
        {loading && (
          <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        )}
        {children}
      </button>
    );
  },
);
OtButton.displayName = 'OtButton';

/* ─── OtInput ─── */

interface OtInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const OtInput = forwardRef<HTMLInputElement, OtInputProps>(
  ({ error, className, ...rest }, ref) => {
    const cls = `ot-input${error ? ' ot-input--error' : ''}${className ? ` ${className}` : ''}`;
    return <input ref={ref} className={cls} {...rest} />;
  },
);
OtInput.displayName = 'OtInput';

/* ─── OtTextarea ─── */

interface OtTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const OtTextarea = forwardRef<HTMLTextAreaElement, OtTextareaProps>(
  ({ error, className, style, ...rest }, ref) => {
    const cls = `ot-input${error ? ' ot-input--error' : ''}${className ? ` ${className}` : ''}`;
    return (
      <textarea
        ref={ref}
        className={cls}
        style={{ resize: 'vertical', minHeight: 80, ...style }}
        {...rest}
      />
    );
  },
);
OtTextarea.displayName = 'OtTextarea';

/* ─── OtAccordion ─── */

interface OtAccordionSectionProps {
  title: string;
  defaultOpen?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  children: React.ReactNode;
}

export function OtAccordionSection({
  title,
  defaultOpen = false,
  pinned,
  onTogglePin,
  children,
}: OtAccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className="border-b border-ot-surface-5">
      <button
        className="w-full flex items-center gap-2 py-3 group"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span
          className="text-ot-text-tertiary text-xs transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▶
        </span>
        <span className="text-[11px] font-medium text-ot-text-secondary uppercase tracking-[0.06em] flex-1 text-left">
          {title}
        </span>
        {onTogglePin && (
          <span
            className={`text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
              pinned ? 'text-ot-violet-400' : 'text-ot-text-ghost'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
          >
            📌
          </span>
        )}
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-300"
        style={{
          maxHeight: open ? contentRef.current?.scrollHeight ?? 2000 : 0,
          opacity: open ? 1 : 0,
        }}
      >
        <div className="pb-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

/* ─── OtToggle ─── */

interface OtToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function OtToggle({ checked, onChange, label, disabled }: OtToggleProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`ot-toggle${checked ? ' ot-toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ot-toggle__thumb" />
      </button>
      {label && <span className="text-xs text-ot-text-secondary">{label}</span>}
    </label>
  );
}

/* ─── OtSegmentedControl ─── */

interface OtSegmentedControlProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labels?: Partial<Record<T, string>>;
}

export function OtSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  labels,
}: OtSegmentedControlProps<T>) {
  return (
    <div className="ot-segmented w-full">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`ot-segmented__item flex-1${opt === value ? ' ot-segmented__item--active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {labels?.[opt] ?? opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  );
}

/* ─── OtTagInput ─── */

interface OtTagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function OtTagInput({ tags, onChange, placeholder }: OtTagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTags = useCallback(
    (raw: string) => {
      const newTags = raw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && !tags.includes(t));
      if (newTags.length > 0) {
        onChange([...tags, ...newTags]);
      }
    },
    [tags, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (inputValue.trim()) {
          addTags(inputValue);
          setInputValue('');
        }
      } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
        onChange(tags.slice(0, -1));
      }
    },
    [inputValue, tags, onChange, addTags],
  );

  const removeTag = useCallback(
    (index: number) => {
      onChange(tags.filter((_, i) => i !== index));
    },
    [tags, onChange],
  );

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 p-2 bg-ot-surface-4 border border-ot-surface-5 rounded-lg cursor-text min-h-[36px]"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span key={tag} className="ot-tag">
          {tag}
          <button
            type="button"
            className="ot-tag__dismiss"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(i);
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-sm text-ot-text-primary placeholder:text-ot-text-ghost"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) {
            addTags(inputValue);
            setInputValue('');
          }
        }}
        placeholder={tags.length === 0 ? placeholder : ''}
      />
    </div>
  );
}

/* ─── OtProgressBar ─── */

interface OtProgressBarProps {
  value?: number;
  indeterminate?: boolean;
  generating?: boolean;
}

export function OtProgressBar({ value, indeterminate, generating }: OtProgressBarProps) {
  const fillClass = indeterminate
    ? 'ot-progress__fill ot-progress__fill--indeterminate'
    : generating
      ? 'ot-progress__fill ot-progress__fill--generating'
      : 'ot-progress__fill';

  return (
    <div className="ot-progress">
      <div
        className={fillClass}
        style={!indeterminate ? { width: `${Math.min(100, value ?? 0)}%` } : undefined}
      />
    </div>
  );
}
