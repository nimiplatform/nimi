import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationSetupAction, ConversationSetupState } from '../types.js';

export type ConversationSetupPanelProps = {
  state: ConversationSetupState;
  title?: ReactNode;
  description?: ReactNode;
  resolveActionLabel?: (action: ConversationSetupAction) => string;
  onAction?: (action: ConversationSetupAction) => void;
  footer?: ReactNode;
  className?: string;
};

function defaultActionLabel(action: ConversationSetupAction): string {
  if (action.kind === 'sign-in') {
    return 'Sign in';
  }
  if (action.targetId === 'runtime-local') {
    return 'Open Local Setup';
  }
  if (action.targetId === 'runtime-cloud') {
    return 'Open Cloud Setup';
  }
  return 'Open Setup';
}

export function ConversationSetupPanel({
  state,
  title,
  description,
  resolveActionLabel,
  onAction,
  footer,
  className,
}: ConversationSetupPanelProps) {
  return (
    <div
      className={cn(
        'flex max-w-xl flex-col gap-5 rounded-2xl p-7',
        'bg-gradient-to-br from-white/95 to-slate-50/90',
        'ring-1 ring-slate-200/40',
        'shadow-[0_20px_52px_rgba(15,23,42,0.06)]',
        className,
      )}
    >
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          {state.status === 'unavailable' ? 'Unavailable' : 'Setup Required'}
        </p>
        <h2 className="text-lg font-semibold text-slate-900">
          {title || 'Conversation setup is incomplete.'}
        </h2>
        {description ? (
          <div className="text-sm text-slate-500">{description}</div>
        ) : null}
      </div>
      {state.issues.length > 0 ? (
        <div className="space-y-2 rounded-xl bg-slate-50/80 p-4 ring-1 ring-slate-200/40">
          {state.issues.map((issue) => (
            <div key={`${issue.code}:${issue.routeKind || 'none'}`} className="text-sm text-slate-500">
              <span className="font-medium text-slate-700">{issue.code}</span>
              {issue.detail ? `: ${issue.detail}` : null}
            </div>
          ))}
        </div>
      ) : null}
      {state.primaryAction ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onAction?.(state.primaryAction!)}
            className={cn(
              'rounded-full px-5 py-2.5 text-sm font-medium text-white',
              'bg-gradient-to-r from-emerald-400 to-teal-400',
              'shadow-[0_8px_20px_rgba(52,211,153,0.25)]',
              'transition-all duration-150',
              'hover:shadow-[0_12px_28px_rgba(52,211,153,0.35)] hover:-translate-y-px',
              'active:scale-[0.98]',
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
