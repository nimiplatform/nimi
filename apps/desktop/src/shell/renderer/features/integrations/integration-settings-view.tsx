import { Button } from '@nimiplatform/kit/ui';
import { LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NimiIntegrationTarget } from '@nimiplatform/sdk/app';

export function integrationAvailabilityKey(target: NimiIntegrationTarget) {
  return target.available
    ? 'Integrations.available'
    : target.kind === 'app'
      ? 'Integrations.providerOffline'
      : target.kind === 'telegram'
        ? 'Integrations.verificationRequired'
        : 'Integrations.connectionUnavailable';
}

export function IntegrationSettingsView({
  target,
  busy,
  setupActive,
  onRefresh,
  onRecheck,
  onVerify,
  onRemove,
}: {
  target: NimiIntegrationTarget;
  busy: boolean;
  setupActive: boolean;
  onRefresh: () => void;
  onRecheck: () => void;
  onVerify: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const canRefresh = ['weixin', 'feishu', 'qq-official', 'onebot-v11'].includes(target.kind);
  const accountLabel = target.accountLabel?.trim();
  const showAccount = accountLabel && accountLabel !== target.displayName.trim();
  const recoveryHelp = canRefresh
    ? 'Integrations.reconnectHelp'
    : target.kind === 'app'
      ? 'Integrations.providerOffline'
      : target.kind === 'telegram'
        ? 'Integrations.verificationRequired'
        : 'Integrations.checkConnectionHelp';
  return (
    <section data-testid="integration-settings" className="space-y-6">
      {!target.available ? (
        <section
          aria-label={t('Integrations.connectionUnavailable')}
          className="rounded-xl border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] p-4"
        >
          <h2 className="text-sm font-semibold text-[var(--nimi-status-warning-soft-text)]">
            {t('Integrations.connectionUnavailable')}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--nimi-status-warning-soft-text)]">
            {t(recoveryHelp)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canRefresh ? (
              <Button tone="primary" size="sm" disabled={busy || setupActive} onClick={onRefresh}>
                {t('Integrations.reconnect')}
              </Button>
            ) : target.kind === 'telegram' ? (
              <Button tone="primary" size="sm" disabled={busy || setupActive} onClick={onVerify}>
                {t('Integrations.verifyConnection')}
              </Button>
            ) : null}
            <Button tone="secondary" size="sm" disabled={busy} onClick={onRecheck}>
              {t('Integrations.recheckStatus')}
            </Button>
          </div>
        </section>
      ) : null}
      {showAccount ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
          <dt className="text-[var(--nimi-text-secondary)]">{t('Integrations.accountIdentity')}</dt>
          <dd className="break-words">{accountLabel}</dd>
        </dl>
      ) : null}
      {target.kind !== 'app' ? (
        <section aria-labelledby="integration-management-heading">
          <h2 id="integration-management-heading" className="text-sm font-semibold">
            {t('Integrations.connectionManagement')}
          </h2>
          <div className="mt-2 divide-y divide-[var(--nimi-border-subtle)]">
            {canRefresh && target.available ? (
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
                <p className="min-w-0 flex-1 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                  {t('Integrations.refreshSummary')}
                </p>
                <Button tone="secondary" size="sm" disabled={busy || setupActive} onClick={onRefresh}>
                  {t('Integrations.refreshConnection')}
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
              <p className="min-w-0 flex-1 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                {t('Integrations.removeSummary')}
              </p>
              <Button
                tone="ghost"
                size="sm"
                className="text-[var(--nimi-status-danger)]"
                disabled={busy || setupActive}
                onClick={onRemove}
              >
                {t('Integrations.removeConfirm')}
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      <details key={target.targetRef} className="border-t border-[var(--nimi-border-subtle)] pt-4 text-xs text-[var(--nimi-text-muted)]">
        <summary className="cursor-pointer">{t('Integrations.technicalDetails')}</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[140px_minmax(0,1fr)]">
          <dt>{t('Integrations.connectionReference')}</dt>
          <dd className="break-all">{target.targetRef}</dd>
          <dt>{t('Integrations.integrationId')}</dt>
          <dd className="break-all">{target.integrationId}</dd>
        </dl>
        {target.skill ? <p className="mt-3 whitespace-pre-wrap break-words">{target.skill}</p> : null}
      </details>
      <p className="flex gap-2 text-xs leading-5 text-[var(--nimi-text-muted)]">
        <LockKeyhole size={15} className="shrink-0" aria-hidden="true" />
        {t('Integrations.custody')}
      </p>
    </section>
  );
}
