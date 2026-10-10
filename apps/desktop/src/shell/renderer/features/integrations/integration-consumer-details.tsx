import { useState } from 'react';
import { IconButton } from '@nimiplatform/kit/ui';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function IntegrationConsumerDetails({ consumerRef }: { consumerRef: string }) {
  const { t } = useTranslation();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    setCopyStatus('copying');
    try {
      await navigator.clipboard.writeText(consumerRef);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  return (
    <details className="mt-2 text-xs text-[var(--nimi-text-muted)]">
      <summary className="cursor-pointer">{t('Integrations.technicalDetails')}</summary>
      <div className="mt-2 max-w-72 space-y-2">
        <p>{t('Integrations.consumerIdentifier')}</p>
        <div className="flex items-start gap-1">
          <code className="block min-w-0 flex-1 select-text break-all">{consumerRef}</code>
          <IconButton
            tone="ghost"
            size="sm"
            aria-label={t('Integrations.copyIdentifier')}
            disabled={copyStatus === 'copying'}
            onClick={() => void copy()}
            icon={copyStatus === 'copied'
              ? <Check className="h-4 w-4" aria-hidden="true" />
              : <Copy className="h-4 w-4" aria-hidden="true" />}
          />
        </div>
        <p role="status" aria-live="polite">
          {copyStatus === 'copied' ? t('Integrations.identifierCopied') : null}
          {copyStatus === 'failed' ? t('Integrations.identifierCopyFailed') : null}
        </p>
      </div>
    </details>
  );
}
