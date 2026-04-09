/**
 * Forge Form Field Components — thin wrappers around kit form primitives.
 *
 * Pattern follows Desktop's `settings-field-components.tsx`:
 * labeled field = label + kit primitive + optional helper text.
 */

import type { ReactNode } from 'react';
import {
  TextField as KitTextField,
  TextareaField as KitTextareaField,
  SelectField as KitSelectField,
  Toggle,
} from '@nimiplatform/nimi-kit/ui';
import type { SelectFieldOption } from '@nimiplatform/nimi-kit/ui';

/* ------------------------------------------------------------------ */
/*  LabeledTextField                                                  */
/* ------------------------------------------------------------------ */

export function LabeledTextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  leading,
  helper,
  readOnly,
  disabled,
  required,
  className,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  leading?: ReactNode;
  helper?: string;
  readOnly?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--nimi-status-danger)]">*</span>}
      </label>
      <KitTextField
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        leading={leading}
      />
      {helper && <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{helper}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LabeledTextareaField                                              */
/* ------------------------------------------------------------------ */

export function LabeledTextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  helper,
  required,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  helper?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--nimi-status-danger)]">*</span>}
      </label>
      <KitTextareaField
        value={value}
        onChange={(e) => maxLength ? onChange(e.target.value.slice(0, maxLength)) : onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
      />
      {maxLength ? (
        <p className="mt-1 text-right text-xs text-[var(--nimi-text-muted)]">
          {value.length}/{maxLength}
        </p>
      ) : helper ? (
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{helper}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LabeledSelectField                                                */
/* ------------------------------------------------------------------ */

export function LabeledSelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
  helper,
  required,
  disabled,
  className,
}: {
  label: string;
  value: string;
  options: SelectFieldOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  // Radix Select.Item does not allow empty-string values.
  // Extract any { value: '' } option as a placeholder instead.
  const emptyOption = options.find((o) => o.value === '');
  const safeOptions = options.filter((o) => o.value !== '');
  const resolvedPlaceholder = placeholder ?? (emptyOption ? String(emptyOption.label) : undefined);

  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--nimi-status-danger)]">*</span>}
      </label>
      <KitSelectField
        value={value}
        options={safeOptions}
        onValueChange={onChange}
        placeholder={resolvedPlaceholder}
        disabled={disabled || safeOptions.length === 0}
      />
      {helper && <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{helper}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ToggleRow                                                         */
/* ------------------------------------------------------------------ */

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  icon,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex min-w-0 flex-1 items-start gap-3 pr-4">
        {icon && <span className="mt-0.5 shrink-0 text-[var(--nimi-text-muted)]">{icon}</span>}
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{label}</p>
          {description && <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{description}</p>}
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
