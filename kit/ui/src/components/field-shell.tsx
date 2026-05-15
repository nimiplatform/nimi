import React, { useId, type ReactElement, type ReactNode } from 'react';
import { cn, type FeedbackTone } from '../design-tokens.js';

type FieldShellProps = {
  label?: ReactNode;
  description?: ReactNode;
  message?: ReactNode;
  messageTone?: FeedbackTone;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
};

export function FieldShell({
  label,
  description,
  message,
  messageTone = 'neutral',
  children,
  className,
}: FieldShellProps) {
  const generatedId = useId();
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const messageId = message ? `${generatedId}-message` : undefined;
  const describedBy = [descriptionId, messageId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('nimi-field-shell flex min-w-0 flex-col gap-1.5', className)}>
      {label ? <label className="nimi-field-shell__label text-[length:var(--nimi-type-label-size)] font-medium text-[var(--nimi-text-secondary)]">{label}</label> : null}
      {description ? <div id={descriptionId} className="nimi-field-shell__description text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{description}</div> : null}
      {React.cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
      })}
      {message ? (
        <div
          id={messageId}
          className={cn(
            'nimi-field-shell__message text-[length:var(--nimi-type-caption-size)]',
            messageTone === 'danger' ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-text-muted)]',
          )}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
