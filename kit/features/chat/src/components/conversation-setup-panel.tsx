import type { ReactNode } from 'react';
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
  return (
    <div
      className={cn(
        'flex max-w-xl flex-col gap-5 rounded-2xl p-7',
        'bg-[linear-gradient(135deg,color-mix(in_srgb,var(--nimi-surface-card)_95%,transparent),color-mix(in_srgb,var(--nimi-surface-panel)_90%,transparent))]',
        'ring-1 ring-[var(--nimi-border-subtle)]',
        'shadow-[var(--nimi-elevation-floating)]',
        className,
      )}
    >
      <div className="space-y-2">
        <p className="text-[length:var(--nimi-type-overline-size)] font-semibold uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
          {eyebrow ?? (state.status === 'unavailable' ? 'Unavailable' : 'Setup Required')}
        </p>
        <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
          {title || 'Conversation setup is incomplete.'}
        </h2>
        {description ? (
          <div className="text-sm text-[var(--nimi-text-muted)]">{description}</div>
        ) : null}
      </div>
      {state.issues.length > 0 ? (
        <details className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-panel)_80%,transparent)] px-4 py-3 ring-1 ring-[var(--nimi-border-subtle)]">
          <summary className="cursor-pointer text-xs font-medium text-[var(--nimi-text-muted)]">
            {diagnosticsLabel || 'Technical details'}
          </summary>
          <div className="mt-2 space-y-1">
            {state.issues.map((issue) => (
              <div key={issue.code} className="font-mono text-xs text-[var(--nimi-text-muted)]">
                <span className="text-[var(--nimi-text-secondary)]">{issue.code}</span>
                {issue.detail ? `: ${issue.detail}` : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {state.primaryAction ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onAction?.(state.primaryAction!)}
            className={cn(
              'rounded-full px-5 py-2.5 text-sm font-medium text-[var(--nimi-action-primary-text)]',
              'bg-[var(--nimi-action-primary-bg)]',
              'shadow-[0_8px_20px_color-mix(in_srgb,var(--nimi-action-primary-bg)_25%,transparent)]',
              'transition-[background-color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
              'hover:bg-[var(--nimi-action-primary-bg-hover)] hover:shadow-[0_12px_28px_color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)]',
              'active:scale-[var(--nimi-motion-pressed-scale)]',
            )}
          >
            {resolveActionLabel?.(state.primaryAction) || defaultActionLabel(state.primaryAction)}
          </button>
        </div>
      ) : null}
      {footer}
    </div>
  );
}
