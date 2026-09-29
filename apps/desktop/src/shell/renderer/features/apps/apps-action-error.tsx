import { InlineAlert } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import type { AppsActionError } from './apps-panel-controller.js';

/** User copy for a failed App action; the raw reason stays in technical details. */
export function AppsActionErrorAlert({ error, className, testId = 'apps-action-error' }: { readonly error: AppsActionError; readonly className?: string; readonly testId?: string }) {
  const { t } = useTranslation();
  return (
    <InlineAlert tone="danger" data-testid={testId} className={className}>
      <p>{error.message}</p>
      {error.detail ? (
        <details className="mt-2 text-xs text-[var(--nimi-text-secondary)]">
          <summary className="cursor-pointer font-semibold">{t('Feedback.technicalDetails', { defaultValue: 'Technical details' })}</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">{error.detail}</pre>
        </details>
      ) : null}
    </InlineAlert>
  );
}
