import { useState, type ReactNode } from 'react';
import { Tooltip, SelectField } from '@nimiplatform/nimi-kit/ui';

const FIELD_BASE = 'w-full rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_8%,var(--nimi-surface-card,#fff))] px-3 text-[13px] text-[var(--nimi-text-primary,#1e293b)] outline-none transition-all hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_32%,transparent)] focus:border-[var(--nimi-field-focus,#10b981)] focus:bg-white focus:ring-2 focus:ring-emerald-100';
const FIELD_HEIGHT = 'h-10';
const FIELD_PLACEHOLDER = 'text-[color-mix(in_srgb,var(--nimi-text-muted,#94a3b8)_80%,transparent)]';

export function FieldLabel(props: { label: string; tooltip?: string }) {
  if (props.tooltip) {
    return (
      <Tooltip content={props.tooltip} placement="top">
        <span className="text-xs font-semibold text-[var(--nimi-text-secondary,#475569)]">{props.label}</span>
      </Tooltip>
    );
  }
  return <span className="text-xs font-semibold text-[var(--nimi-text-secondary,#475569)]">{props.label}</span>;
}

export function FieldRow(props: { label: string; tooltip?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <FieldLabel label={props.label} tooltip={props.tooltip} />
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
    <input
      type="text"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      className={`${FIELD_BASE} ${FIELD_HEIGHT} placeholder:${FIELD_PLACEHOLDER}`}
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
    <SelectField
      value={props.value}
      onValueChange={props.onChange}
      options={props.options}
      placeholder={props.placeholder}
      selectClassName="min-h-10 rounded-xl px-3 text-sm"
    />
  );
}

export function FieldTextarea(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      rows={props.rows || 3}
      className={`${FIELD_BASE} resize-y py-2.5 placeholder:${FIELD_PLACEHOLDER}`}
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
      <span className="text-xs font-semibold text-[var(--nimi-text-secondary,#475569)]">{props.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className={[
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
          props.checked ? 'bg-emerald-500' : 'bg-slate-200',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            props.checked ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </label>
  );
}

export function PreviewBadge(props: { label: string }) {
  return (
    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-600">
      {props.label}
    </span>
  );
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
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:shadow-sm"
      />
      <span className="w-10 shrink-0 text-right text-[13px] font-medium tabular-nums text-[var(--nimi-text-primary,#1e293b)]">{props.value}</span>
    </div>
  );
}

export function SubSectionLabel(props: {
  label: string;
  previewLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="h-px flex-1 bg-[color-mix(in_srgb,var(--nimi-border-subtle,#e2e8f0)_70%,transparent)]" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--nimi-text-muted,#94a3b8)]">{props.label}</span>
      {props.previewLabel ? <PreviewBadge label={props.previewLabel} /> : null}
      <div className="h-px flex-1 bg-[color-mix(in_srgb,var(--nimi-border-subtle,#e2e8f0)_70%,transparent)]" />
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
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="text-[13px] font-semibold text-[var(--nimi-text-primary,#0f172a)]">{props.label}</span>
      {props.trailing ? <span className="ml-auto">{props.trailing}</span> : null}
    </div>
  );
}

const STEPPER_BUTTON_BASE =
  'inline-flex h-10 w-9 shrink-0 items-center justify-center text-[var(--nimi-text-secondary,#475569)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_10%,transparent)] hover:text-[var(--nimi-action-primary-bg,#10b981)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--nimi-text-secondary,#475569)]';

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
    <div className="flex h-10 w-full items-stretch overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_8%,var(--nimi-surface-card,#fff))] transition-all focus-within:border-[var(--nimi-field-focus,#10b981)] focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100 hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_32%,transparent)]">
      <button
        type="button"
        aria-label="Decrement"
        className={STEPPER_BUTTON_BASE}
        onClick={() => adjust(-1)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <input
        type="text"
        inputMode={props.inputMode ?? 'decimal'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="min-w-0 flex-1 bg-transparent px-1 text-center text-[13px] tabular-nums text-[var(--nimi-text-primary,#1e293b)] outline-none placeholder:text-[color-mix(in_srgb,var(--nimi-text-muted,#94a3b8)_80%,transparent)]"
      />
      <button
        type="button"
        aria-label="Increment"
        className={STEPPER_BUTTON_BASE}
        onClick={() => adjust(1)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
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
    <div className="overflow-hidden rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-[var(--nimi-surface-card,#ffffff)]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-raised,#f8fafc)_70%,transparent)]"
      >
        <span className="relative inline-flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--nimi-text-primary,#0f172a)]">{props.title}</div>
          {props.description ? (
            <div className="mt-0.5 truncate text-[11px] text-[var(--nimi-text-muted,#94a3b8)]">{props.description}</div>
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
          className={`shrink-0 text-[var(--nimi-text-muted,#94a3b8)] transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open ? (
        <div className="border-t border-[var(--nimi-border-subtle,#e2e8f0)] px-4 py-3.5">
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
