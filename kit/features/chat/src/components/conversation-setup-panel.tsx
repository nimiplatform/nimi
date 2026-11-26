import type { ReactNode } from 'react';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { Button, cn } from '@nimiplatform/kit/ui';
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
        <Button
          tone="primary"
          size="md"
          onClick={() => onAction?.(state.primaryAction!)}
          className="px-6 py-3"
        >
          {resolveActionLabel?.(state.primaryAction) || defaultActionLabel(state.primaryAction)}
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      ) : null}
      {footer}
    </div>
  );
}
