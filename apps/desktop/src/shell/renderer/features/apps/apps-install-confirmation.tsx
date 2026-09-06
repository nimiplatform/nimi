import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@nimiplatform/kit/ui';
import type { AppsInstallIntentSnapshot } from './apps-install-intent.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.r053

export function AppsInstallConfirmationDialog({
  intent,
  pending,
  onConfirm,
  onClose,
}: {
  readonly intent: AppsInstallIntentSnapshot | null;
  readonly pending: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={intent !== null}
      title={t('Apps.catalog.unsignedConfirmTitle')}
      message={intent ? (
        <div className="space-y-3">
          <p>{t('Apps.catalog.unsignedConfirmMessage')}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs">
            <dt>{t('Apps.catalog.publisher')}</dt>
            <dd className="break-all text-right">{intent.displayName} · @{intent.publisherGithubNamespace}</dd>
            <dt>{t('LocalDevelopment.field.app')}</dt>
            <dd className="break-all text-right">{intent.appId}@{intent.version}</dd>
            <dt>{t('Apps.catalog.target')}</dt>
            <dd className="break-all text-right">{intent.targetId}</dd>
            <dt>{t('Apps.catalog.asset')}</dt>
            <dd className="break-all text-right">{intent.assetName} · {intent.assetSize} bytes</dd>
          </dl>
        </div>
      ) : ''}
      confirmLabel={t('Apps.catalog.unsignedConfirmAction')}
      cancelLabel={t('Common.cancel')}
      pending={pending}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
