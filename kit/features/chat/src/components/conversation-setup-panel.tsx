import type { ReactNode } from 'react';
import { ChevronRight, CircleAlert, Sparkles } from 'lucide-react';
import { cn } from '@nimiplatform/kit/ui';
import type { ConversationSetupAction, ConversationSetupState } from '../types.js';

export type ConversationSetupPanelProps = {
  state: ConversationSetupState;
  /** Overline label above the title; defaults to the status-based engineering label. */
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Label for the collapsed diagnostics disclosure that carries raw issue codes. */
  diagnosticsLabel?: string;
  resolveActionLabel?: (action: ConversationSetupAction) => string;
  onAction?: (action: ConversationSetupAction) => void;
  footer?: ReactNode;
  className?: string;
};

function defaultActionLabel(action: ConversationSetupAction): string {
  if (action.kind === 'sign-in') {
    return 'Sign in';
  }
  return 'Open Setup';
}

export function ConversationSetupPanel({
  state,
  eyebrow,
  title,
  description,
  diagnosticsLabel,
  resolveActionLabel,
  onAction,
  footer,
  className,
}: ConversationSetupPanelProps) {
  const unavailable = state.status === 'unavailable';
  const accentToken = unavailable ? 'var(--nimi-status-warning)' : 'var(--nimi-action-primary-bg)';
  const StatusIcon = unavailable ? CircleAlert : Sparkles;
  return (
    <div
      className={cn(
        'flex max-w-md flex-col items-center gap-6 rounded-2xl px-8 py-8 text-center',
        'bg-[linear-gradient(160deg,color-mix(in_srgb,var(--nimi-surface-card)_96%,transparent),color-mix(in_srgb,var(--nimi-surface-panel)_92%,transparent))]',
        'ring-1 ring-[var(--nimi-border-subtle)]',
        'shadow-[var(--nimi-elevation-floating)]',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{
            color: accentToken,
            background: `color-mix(in srgb, ${accentToken} 10%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentToken} 22%, transparent)`,
          }}
        >
          <StatusIcon className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <div className="space-y-2">
          <p className="flex items-center justify-center gap-2 text-[length:var(--nimi-type-overline-size)] font-semibold uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: accentToken }}
            />
            {eyebrow ?? (unavailable ? 'Unavailable' : 'Setup Required')}
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-[var(--nimi-text-primary)]">
            {title || 'Conversation setup is incomplete.'}
          </h2>
          {description ? (
            <div className="mx-auto max-w-sm text-sm leading-6 text-[var(--nimi-text-muted)]">{description}</div>
          ) : null}
        </div>
      </div>
      {state.primaryAction ? (
        <button
          type="button"
          onClick={() => onAction?.(state.primaryAction!)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-medium text-[var(--nimi-action-primary-text)]',
            'bg-[var(--nimi-action-primary-bg)]',
            'shadow-[0_8px_20px_color-mix(in_srgb,var(--nimi-action-primary-bg)_25%,transparent)]',
            'transition-[background-color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
            'hover:bg-[var(--nimi-action-primary-bg-hover)] hover:shadow-[0_12px_28px_color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)]',
            'active:scale-[var(--nimi-motion-pressed-scale)]',
          )}
        >
          {resolveActionLabel?.(state.primaryAction) || defaultActionLabel(state.primaryAction)}
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
      {state.issues.length > 0 ? (
        <details className="group w-full rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-panel)_80%,transparent)] px-4 py-2.5 ring-1 ring-[var(--nimi-border-subtle)]">
          <summary className="flex cursor-pointer select-none list-none items-center justify-center gap-1.5 text-xs font-medium text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-text-secondary)] [&::-webkit-details-marker]:hidden">
            {diagnosticsLabel || 'Technical details'}
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform duration-[var(--nimi-motion-fast)] group-open:rotate-90" />
          </summary>
          <div className="mt-2 space-y-1 border-t border-[var(--nimi-border-subtle)] pt-2 text-left">
            {state.issues.map((issue) => (
              <div key={issue.code} className="font-mono text-xs text-[var(--nimi-text-muted)]">
                <span className="text-[var(--nimi-text-secondary)]">{issue.code}</span>
                {issue.detail ? `: ${issue.detail}` : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {footer}
    </div>
  );
}
