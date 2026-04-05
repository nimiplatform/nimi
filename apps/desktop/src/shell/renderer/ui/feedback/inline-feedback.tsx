import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import type { StatusKind } from '@renderer/app-shell/providers/app-store';

export type InlineFeedbackState = {
  kind: StatusKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

const TONE_STYLES: Record<StatusKind, {
  shell: string;
  title: string;
  body: string;
  icon: ReactNode;
}> = {
  info: {
    shell: 'border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_8%,var(--nimi-surface-card))]',
    title: 'text-[var(--nimi-status-info)]',
    body: 'text-[color-mix(in_srgb,var(--nimi-status-info)_78%,var(--nimi-text-secondary))]',
    icon: 'i',
  },
  success: {
    shell: 'border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,var(--nimi-surface-card))]',
    title: 'text-[var(--nimi-status-success)]',
    body: 'text-[color-mix(in_srgb,var(--nimi-status-success)_78%,var(--nimi-text-secondary))]',
    icon: 'OK',
  },
  warning: {
    shell: 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))]',
    title: 'text-[var(--nimi-status-warning)]',
    body: 'text-[color-mix(in_srgb,var(--nimi-status-warning)_78%,var(--nimi-text-secondary))]',
    icon: '!',
  },
  error: {
    shell: 'border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))]',
    title: 'text-[var(--nimi-status-danger)]',
    body: 'text-[color-mix(in_srgb,var(--nimi-status-danger)_80%,var(--nimi-text-secondary))]',
    icon: 'X',
  },
};

export function InlineFeedback(props: {
  feedback: InlineFeedbackState | null;
  className?: string;
  title?: string;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const { feedback, className, title, onDismiss } = props;
  if (!feedback) {
    return null;
  }
  const tone = TONE_STYLES[feedback.kind];
  return (
    <div className={cn('rounded-2xl border px-4 py-3', tone.shell, className)}>
      <div className="flex items-start gap-3">
        <div className={cn('flex h-7 min-w-7 items-center justify-center rounded-full text-[11px] font-semibold', tone.title)}>
          {tone.icon}
        </div>
        <div className="min-w-0 flex-1">
          {title ? <p className={cn('text-xs font-semibold uppercase tracking-[0.06em]', tone.title)}>{title}</p> : null}
          <p className={cn(title ? 'mt-1 text-sm' : 'text-sm', tone.body)}>{feedback.message}</p>
          {feedback.actionLabel && feedback.onAction ? (
            <button
              type="button"
              onClick={feedback.onAction}
              className={cn('mt-2 text-xs font-semibold underline underline-offset-2', tone.title)}
            >
              {feedback.actionLabel}
            </button>
          ) : null}
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('Feedback.dismiss', { defaultValue: 'Dismiss feedback' })}
            className="text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-text-primary)]"
          >
            x
          </button>
        ) : null}
      </div>
    </div>
  );
}
