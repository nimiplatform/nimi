import type { ReactNode } from 'react';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { cn } from '@nimiplatform/kit/ui';
import type { ConversationSetupAction, ConversationSetupState } from '../types.js';

export type ConversationSetupPanelProps = {
  state: ConversationSetupState;
  title?: ReactNode;
  description?: ReactNode;
  /** Product brand mark or glyph rendered above the title. The unavailable state
   *  always shows its status icon instead; without an icon the panel stays typographic. */
  icon?: ReactNode;
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
  title,
  description,
  icon,
  resolveActionLabel,
  onAction,
  footer,
  className,
}: ConversationSetupPanelProps) {
  const unavailable = state.status === 'unavailable';
  const accentToken = unavailable ? 'var(--nimi-status-warning)' : 'var(--nimi-action-primary-bg)';
  return (
    <div
      className={cn(
        'flex max-w-md flex-col items-center gap-8 text-center',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-5">
        {unavailable ? (
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              color: accentToken,
              background: `color-mix(in srgb, ${accentToken} 10%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentToken} 22%, transparent)`,
            }}
          >
            <CircleAlert className="h-7 w-7" strokeWidth={1.5} />
          </div>
        ) : icon ? (
          <div aria-hidden="true" className="flex items-center justify-center">
            {icon}
          </div>
        ) : null}
        <div className="space-y-3">
          <h2 className="text-[length:var(--nimi-type-page-title-size)] font-bold tracking-tight text-[var(--nimi-text-primary)]">
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
            'inline-flex items-center gap-1.5 rounded-[var(--nimi-radius-action)] px-6 py-3 text-sm font-medium text-[var(--nimi-action-primary-text)]',
            'bg-[var(--nimi-action-primary-bg)]',
            'shadow-[0_6px_16px_color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)]',
            'transition-[background-color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
            'hover:bg-[var(--nimi-action-primary-bg-hover)] hover:shadow-[0_10px_24px_color-mix(in_srgb,var(--nimi-action-primary-bg)_26%,transparent)]',
            'active:scale-[var(--nimi-motion-pressed-scale)]',
          )}
        >
          {resolveActionLabel?.(state.primaryAction) || defaultActionLabel(state.primaryAction)}
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
      {footer}
    </div>
  );
}
