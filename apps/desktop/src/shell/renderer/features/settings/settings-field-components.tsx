import type { ReactNode } from 'react';
import {
  SelectField as KitSelectField,
  TextareaField as KitTextareaField,
  TextField as KitTextField,
  Toggle,
} from '@nimiplatform/nimi-kit/ui';

/* ------------------------------------------------------------------ */
/*  ToggleRow — labeled toggle using kit Toggle for the switch        */
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
  onChange: (v: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex min-w-0 flex-1 items-start gap-3 pr-4">
        {icon && <span className="mt-0.5 shrink-0 text-gray-400">{icon}</span>}
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SelectField — labeled select using kit SelectField                */
/* ------------------------------------------------------------------ */

export function SelectField({
  label,
  value,
  options,
  onChange,
  helper,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  helper?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      <KitSelectField
        value={value}
        options={options}
        onValueChange={onChange}
      />
      {helper && <p className="mt-1 text-xs text-gray-500">{helper}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TextField — labeled text input using kit TextField                */
/* ------------------------------------------------------------------ */

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  icon,
  helper,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
  icon?: ReactNode;
  helper?: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      <KitTextField
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        readOnly={readOnly}
        leading={icon}
      />
      {helper && <p className="mt-1 text-xs text-gray-500">{helper}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TextAreaField — labeled textarea using kit TextareaField           */
/* ------------------------------------------------------------------ */

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      <KitTextareaField
        value={value}
        onChange={(e) => maxLength ? onChange(e.target.value.slice(0, maxLength)) : onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
      />
      {maxLength && (
        <p className="mt-1 text-right text-xs text-gray-400">
          {value.length}/{maxLength} characters
        </p>
      )}
    </div>
  );
}
