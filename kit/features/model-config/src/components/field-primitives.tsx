import { useState, type ReactNode } from 'react';
import {
  Button,
  StatusBadge,
  TextareaField,
  TextField,
  Toggle,
  cn,
} from '@nimiplatform/kit/ui';

const FIELD_HEIGHT = 'min-h-[var(--nimi-sizing-field-md-height)]';

export function FieldLabel(props: { label: string; tooltip?: string; requirementLabel?: string }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[var(--nimi-text-secondary)]"
      title={props.tooltip}
      aria-label={props.tooltip ? `${props.label}: ${props.tooltip}` : props.label}
    >
      <span className="truncate">{props.label}</span>
      {props.requirementLabel ? (
        <StatusBadge tone="warning" className="px-1.5 py-0.5 text-[9px] uppercase">
          {props.requirementLabel}
        </StatusBadge>
      ) : null}
    </span>
  );
}

export function FieldRow(props: { label: string; tooltip?: string; requirementLabel?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <FieldLabel label={props.label} tooltip={props.tooltip} requirementLabel={props.requirementLabel} />
      {props.children}
    </div>
  );
}

export function FieldInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <TextField
      type="text"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      className={FIELD_HEIGHT}
      inputClassName="text-[length:var(--nimi-type-body-sm-size)]"
    />
  );
}

export function FieldSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      className="min-h-10 w-full rounded-xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-field-text)] outline-none transition-colors duration-[var(--nimi-motion-fast)] focus:border-[var(--nimi-field-focus)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)]"
      aria-label={props.placeholder}
    >
      {props.placeholder ? (
        <option value="" disabled>
          {props.placeholder}
        </option>
      ) : null}
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function FieldTextarea(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <TextareaField
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      rows={props.rows || 3}
      textareaClassName="text-[length:var(--nimi-type-body-sm-size)]"
    />
  );
}

export function FieldToggle(props: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between py-1">
      <span className="text-xs font-semibold text-[var(--nimi-text-secondary)]">{props.label}</span>
      <Toggle checked={props.checked} onChange={props.onChange} />
    </label>
  );
}

export function PreviewBadge(props: { label: string }) {
  return <StatusBadge tone="warning" className="px-1.5 py-0.5 text-[9px] uppercase">{props.label}</StatusBadge>;
}

export function FieldSlider(props: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-[var(--nimi-radius-full)] bg-[var(--nimi-toggle-off-bg)] accent-[var(--nimi-action-primary-bg)] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[var(--nimi-radius-full)] [&::-webkit-slider-thumb]:bg-[var(--nimi-action-primary-bg)] [&::-webkit-slider-thumb]:shadow-[var(--nimi-elevation-base)]"
      />
      <span className="w-10 shrink-0 text-right text-[length:var(--nimi-type-body-sm-size)] font-medium tabular-nums text-[var(--nimi-text-primary)]">{props.value}</span>
    </div>
  );
}

export function SubSectionLabel(props: {
  label: string;
  previewLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="h-px flex-1 bg-[var(--nimi-border-subtle)]" />
      <span className="text-[10px] font-semibold uppercase tracking-[var(--nimi-type-label-letter-spacing)] text-[var(--nimi-text-muted)]">{props.label}</span>
      {props.previewLabel ? <PreviewBadge label={props.previewLabel} /> : null}
      <div className="h-px flex-1 bg-[var(--nimi-border-subtle)]" />
    </div>
  );
}

export function SectionGroupHeader(props: {
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 pb-2 pt-1">
      <span className="relative inline-flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-[var(--nimi-radius-full)] bg-[color-mix(in_srgb,var(--nimi-status-success)_40%,transparent)]" />
        <span className="relative inline-flex h-2 w-2 rounded-[var(--nimi-radius-full)] bg-[var(--nimi-status-success)]" />
      </span>
      <span className="text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">{props.label}</span>
      {props.trailing ? <span className="ml-auto">{props.trailing}</span> : null}
    </div>
  );
}

const STEPPER_BUTTON_BASE =
  'h-full w-9 rounded-none border-0 text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-action-primary-bg)]';

function clampStepperValue(next: number, min?: number, max?: number): number {
  let value = next;
  if (typeof min === 'number') value = Math.max(min, value);
  if (typeof max === 'number') value = Math.min(max, value);
  return value;
}

function formatStepperValue(value: number, step: number): string {
  if (Number.isInteger(step) && Number.isInteger(value)) return String(value);
  const decimals = (() => {
    const fragment = String(step).split('.')[1];
    return fragment ? Math.min(fragment.length, 4) : 2;
  })();
  return Number.parseFloat(value.toFixed(decimals)).toString();
}

export function NumberStepperField(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
  defaultStart?: number;
  inputMode?: 'numeric' | 'decimal';
}) {
  const step = props.step ?? 1;
  const defaultStart = props.defaultStart ?? 0;

  const adjust = (direction: 1 | -1) => {
    const parsed = props.value === '' ? Number.NaN : Number(props.value);
    const base = Number.isFinite(parsed) ? parsed : defaultStart;
    const next = clampStepperValue(base + direction * step, props.min, props.max);
    props.onChange(formatStepperValue(next, step));
  };

  return (
    <div className="flex min-h-[var(--nimi-sizing-field-md-height)] w-full items-stretch overflow-hidden rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-[var(--nimi-field-text)] transition-colors duration-[var(--nimi-motion-fast)] focus-within:border-[var(--nimi-field-focus)] focus-within:ring-[length:var(--nimi-focus-ring-width)] focus-within:ring-[var(--nimi-focus-ring-color)]">
      <Button
        aria-label="Decrement"
        tone="ghost"
        size="sm"
        className={STEPPER_BUTTON_BASE}
        onClick={() => adjust(-1)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </Button>
      <input
        type="text"
        inputMode={props.inputMode ?? 'decimal'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="min-w-0 flex-1 bg-transparent px-1 text-center text-[length:var(--nimi-type-body-sm-size)] tabular-nums text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-field-placeholder)]"
      />
      <Button
        aria-label="Increment"
        tone="ghost"
        size="sm"
        className={STEPPER_BUTTON_BASE}
        onClick={() => adjust(1)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </Button>
    </div>
  );
}

export function CollapsibleSection(props: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <div className="overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
      >
        <span className="relative inline-flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-[var(--nimi-radius-full)] bg-[color-mix(in_srgb,var(--nimi-status-success)_40%,transparent)]" />
          <span className="relative inline-flex h-2 w-2 rounded-[var(--nimi-radius-full)] bg-[var(--nimi-status-success)]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">{props.title}</div>
          {props.description ? (
            <div className="mt-0.5 truncate text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{props.description}</div>
          ) : null}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[var(--nimi-text-muted)] transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open ? (
        <div className="border-t border-[var(--nimi-border-subtle)] px-4 py-3.5">
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
