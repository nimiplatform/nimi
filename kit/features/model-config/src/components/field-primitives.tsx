import type { ReactNode } from 'react';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';

const FIELD_BASE = 'w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition-colors hover:border-slate-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const FIELD_HEIGHT = 'h-10';
const FIELD_PLACEHOLDER = 'text-slate-400';

export function FieldLabel(props: { label: string; tooltip?: string }) {
  if (props.tooltip) {
    return (
      <Tooltip content={props.tooltip} placement="top">
        <span className="text-xs font-medium text-slate-500">{props.label}</span>
      </Tooltip>
    );
  }
  return <span className="text-xs font-medium text-slate-500">{props.label}</span>;
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
    <select
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      className={`${FIELD_BASE} ${FIELD_HEIGHT}`}
    >
      {props.placeholder ? <option value="">{props.placeholder}</option> : null}
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
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
      <span className="text-xs font-medium text-slate-500">{props.label}</span>
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

export function SubSectionLabel(props: {
  label: string;
  previewLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="h-px flex-1 bg-slate-100" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300">{props.label}</span>
      {props.previewLabel ? <PreviewBadge label={props.previewLabel} /> : null}
      <div className="h-px flex-1 bg-slate-100" />
    </div>
  );
}
