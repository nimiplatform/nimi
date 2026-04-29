import { useState, type ReactNode } from 'react';

/**
 * Shared layout primitives for capability params editors.
 *
 * These are the visual building blocks of the "Chat Configuration" reference
 * layout (see {@link TextGenerateParamsEditor}). Other editors (TTS, STT, …)
 * import the same primitives so the detail screens stay visually consistent.
 */

export function EditorSectionTitle(props: { label: string }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted,#94a3b8)]">
      {props.label}
    </div>
  );
}

export function formatNumeric(value: number, step: number): string {
  if (Number.isInteger(step) && Number.isInteger(value)) return String(value);
  const decimals = (() => {
    const fragment = String(step).split('.')[1];
    return fragment ? Math.min(fragment.length, 4) : 2;
  })();
  return Number.parseFloat(value.toFixed(decimals)).toString();
}

/**
 * Slider row with a right-aligned editable value chip — matches the reference layout.
 *
 *   Temperature                                [ 0.70 ]
 *   ──────●──────────────────────
 */
export function SliderRow(props: {
  label: string;
  value: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  inputMode?: 'numeric' | 'decimal';
  onChange: (next: string) => void;
  children?: ReactNode;
}) {
  const parsed = props.value === '' ? Number.NaN : Number(props.value);
  const sliderNumeric = Number.isFinite(parsed) ? parsed : props.defaultValue;
  const placeholder = formatNumeric(props.defaultValue, props.step);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-[var(--nimi-text-primary,#0f172a)]">{props.label}</span>
        <input
          type="text"
          inputMode={props.inputMode ?? 'decimal'}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={placeholder}
          className="h-7 w-16 rounded-md border border-transparent bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_10%,transparent)] px-2 text-right text-[12px] font-semibold tabular-nums text-[var(--nimi-text-primary,#0f172a)] outline-none transition placeholder:text-[var(--nimi-text-muted,#94a3b8)] focus:border-[var(--nimi-action-primary-bg,#10b981)] focus:bg-white focus:ring-2 focus:ring-emerald-100"
        />
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={sliderNumeric}
        onChange={(event) => props.onChange(formatNumeric(Number(event.target.value), props.step))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:shadow-sm"
      />
      {props.children}
    </div>
  );
}

const PLAIN_NUMBER_INPUT_CLASS =
  'h-9 w-full rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle,#e2e8f0)_90%,transparent)] bg-white px-2.5 text-[13px] tabular-nums text-[var(--nimi-text-primary,#0f172a)] outline-none transition focus:border-[var(--nimi-action-primary-bg,#10b981)] focus:ring-2 focus:ring-emerald-100 placeholder:text-[var(--nimi-text-muted,#94a3b8)]';

export function PlainNumberInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'numeric' | 'decimal';
}) {
  return (
    <input
      type="text"
      inputMode={props.inputMode ?? 'decimal'}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      className={PLAIN_NUMBER_INPUT_CLASS}
    />
  );
}

const PLAIN_TEXT_INPUT_CLASS =
  'h-9 w-full rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle,#e2e8f0)_90%,transparent)] bg-white px-2.5 text-[13px] text-[var(--nimi-text-primary,#0f172a)] outline-none transition focus:border-[var(--nimi-action-primary-bg,#10b981)] focus:ring-2 focus:ring-emerald-100 placeholder:text-[var(--nimi-text-muted,#94a3b8)]';

export function PlainTextInput(props: {
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
      className={PLAIN_TEXT_INPUT_CLASS}
    />
  );
}

const PLAIN_SELECT_CLASS =
  'h-9 w-full rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle,#e2e8f0)_90%,transparent)] bg-white px-2.5 text-[13px] text-[var(--nimi-text-primary,#0f172a)] outline-none transition focus:border-[var(--nimi-action-primary-bg,#10b981)] focus:ring-2 focus:ring-emerald-100';

export function PlainSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <select
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      className={PLAIN_SELECT_CLASS}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Inline label/control row used for one-line scalars (Timeout, etc.).
 * Mirrors the chat editor's Timeout row.
 */
export function InlineFieldRow(props: {
  label: string;
  controlWidthClass?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] font-medium text-[var(--nimi-text-primary,#0f172a)]">{props.label}</span>
      <div className={`shrink-0 ${props.controlWidthClass ?? 'w-32'}`}>{props.children}</div>
    </div>
  );
}

/**
 * Stacked label/control row — label on top, full-width control below.
 * Used for text inputs that need room (voiceId, languageHint, …).
 */
export function StackedFieldRow(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium text-[var(--nimi-text-secondary,#475569)]">
        {props.label}
      </div>
      {props.children}
      {props.hint ? (
        <div className="text-[11px] text-[var(--nimi-text-muted,#94a3b8)]">{props.hint}</div>
      ) : null}
    </div>
  );
}

/**
 * Flat collapsible row — visually a horizontal divider with the title on the left and
 * a chevron on the right. Replaces bordered card-style collapsibles to match the
 * minimal "Advanced Settings >" footer in the Active Model reference layout.
 */
export function AdvancedRow(props: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-[var(--nimi-border-subtle,#e2e8f0)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[13px] font-medium text-[var(--nimi-text-secondary,#475569)]">{props.title}</span>
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
      {open ? <div className="pt-3.5">{props.children}</div> : null}
    </div>
  );
}
