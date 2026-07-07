import type { ReactNode } from 'react';
import { AppCardSurface, CompactAction } from '@nimiplatform/kit/ui';

export const DIAGNOSTIC_INPUT_CLASS_NAME = 'mt-1.5 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] outline-none transition focus:border-[color:var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] disabled:cursor-not-allowed disabled:opacity-50';
// Same input look but no top margin — used inside DiagnosticsInlineField where the
// label sits to the LEFT, not above, so the field shouldn't push itself down.
export const DIAGNOSTIC_INLINE_INPUT_CLASS_NAME = 'w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] outline-none transition focus:border-[color:var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] disabled:cursor-not-allowed disabled:opacity-50';

export const CHAT_DIAGNOSTICS_AUTONOMY_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

/**
 * Compact key/value row used inside the Advanced/Debug Runtime overview grid.
 * Picks a tone class from the value text so "Ready" renders green, "Loading…"
 * sky-blue, all-caps tokens (MASTER_OWNED) mono, and everything else neutral.
 */
export function DiagnosticsKv(props: { label: string; value: string; detail?: string }) {
  const trimmed = props.value.trim();
  const isLoading = /^(loading|checking)/i.test(trimmed) || trimmed.endsWith('…') || /loading\.{2,3}$/i.test(trimmed);
  const isReady = /^(ready|runtime ready|on)$/i.test(trimmed);
  const isMonoToken = /^[A-Z][A-Z0-9_]+$/.test(trimmed);
  const valueClass = isLoading
    ? 'text-sky-700'
    : isReady
      ? 'text-[var(--nimi-status-success)] font-semibold'
      : isMonoToken
        ? 'font-mono text-[11px] text-slate-900'
        : 'text-slate-900';
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{props.label}</div>
      <div className={`mt-1 truncate text-[13px] font-semibold ${valueClass}`} title={trimmed}>
        {trimmed || '—'}
      </div>
      {props.detail ? (
        <div className="mt-0.5 truncate text-[11.5px] leading-[1.5] text-slate-600">{props.detail}</div>
      ) : null}
    </div>
  );
}

export function DiagnosticsSectionCard(props: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppCardSurface kind="operational-solid" as="div" className="space-y-3 px-3.5 py-3">
      <div className="space-y-1">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
          {props.title}
        </h4>
        {props.hint ? (
          <p className="text-[11px] leading-5 text-[var(--nimi-text-muted)]">{props.hint}</p>
        ) : null}
      </div>
      {props.children}
    </AppCardSurface>
  );
}

export function DiagnosticsFieldLabel(props: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nimi-text-muted)]">
      {props.label}
      {props.children}
    </label>
  );
}

export function RuntimeInspectActionButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger';
}) {
  return (
    <CompactAction onClick={props.onClick} disabled={props.disabled} tone={props.tone}>
      {props.label}
    </CompactAction>
  );
}

/**
 * Ghost-red action used for destructive recovery operations (Clear context, Clear override).
 * Same height as CompactAction but tertiary-weight so the primary "Apply X" stays the
 * single visual focus per section.
 */
export function DiagnosticsDangerGhostButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="inline-flex h-[30px] items-center justify-center whitespace-nowrap rounded-xl border border-transparent bg-transparent px-3 text-[12px] font-medium text-red-700 transition-colors hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.label}
    </button>
  );
}

/**
 * Inline-left labeled row for short, single-line debug inputs. Halves vertical space
 * compared to label-on-top forms while preserving uppercase-tracked label visuals.
 */
export function DiagnosticsInlineField(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-[120px] shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
        {props.label}
      </label>
      <div className="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

/** Small icon-only button used in AdvBlock headers (e.g. Refresh inspect). */
export function DiagnosticsHeaderIconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-slate-200/90 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={props.spinning ? 'animate-spin' : undefined}>{props.children}</span>
    </button>
  );
}
