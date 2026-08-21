import { InlineAlert, cn, type FeedbackTone } from '@nimiplatform/kit/ui';
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StatusKind } from '../../app-shell/providers/app-store';

export type InlineFeedbackState = {
  kind: StatusKind;
  message: string;
  technicalDetail?: string;
  actionLabel?: string;
  onAction?: () => void;
};

const TONE_STYLES: Record<StatusKind, {
  alertTone: FeedbackTone;
  title: string;
  body: string;
  icon: LucideIcon;
}> = {
  info: {
    alertTone: 'info',
    title: 'text-[var(--nimi-status-info)]',
    body: 'text-[color:var(--nimi-status-info-soft-text)]',
    icon: Info,
  },
  success: {
    alertTone: 'success',
    title: 'text-[var(--nimi-status-success)]',
    body: 'text-[color:var(--nimi-status-success-soft-text)]',
    icon: CircleCheck,
  },
  warning: {
    alertTone: 'warning',
    title: 'text-[var(--nimi-status-warning)]',
    body: 'text-[color:var(--nimi-status-warning-soft-text)]',
    icon: TriangleAlert,
  },
  error: {
    alertTone: 'danger',
    title: 'text-[var(--nimi-status-danger)]',
    body: 'text-[color:var(--nimi-status-danger-soft-text)]',
    icon: CircleX,
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
  const ToneIcon = tone.icon;
  return (
    <InlineAlert
      data-feedback-kind={feedback.kind}
      tone={tone.alertTone}
      className={cn('px-4 py-3', className)}
      icon={<ToneIcon className="h-4 w-4" aria-hidden />}
      action={onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('Feedback.dismiss', { defaultValue: 'Dismiss feedback' })}
          className="text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-text-primary)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : undefined}
    >
      {title ? <p className={cn('text-xs font-semibold uppercase tracking-[0.06em]', tone.title)}>{title}</p> : null}
      <p className={cn(title ? 'mt-1 text-sm' : 'text-sm', 'break-words [overflow-wrap:anywhere]', tone.body)}>{feedback.message}</p>
      {feedback.technicalDetail ? (
        <details className="mt-2 text-xs text-[var(--nimi-text-secondary)]">
          <summary className="cursor-pointer font-semibold">
            {t('Feedback.technicalDetails', { defaultValue: 'Technical details' })}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
            {feedback.technicalDetail}
          </pre>
        </details>
      ) : null}
      {feedback.actionLabel && feedback.onAction ? (
        <button
          type="button"
          onClick={feedback.onAction}
          className={cn('mt-2 text-xs font-semibold underline underline-offset-2', tone.title)}
        >
          {feedback.actionLabel}
        </button>
      ) : null}
    </InlineAlert>
  );
}
