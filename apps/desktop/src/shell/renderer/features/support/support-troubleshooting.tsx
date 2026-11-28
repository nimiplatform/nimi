import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, useTypedProjection } from '@nimiplatform/kit/ui';
import { NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY } from '@nimiplatform/sdk/runtime';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useDesktopFormalSessionRecovery } from '../../app-shell/routes/desktop-formal-session.js';
import {
  useOptionalProductUpdate,
  type ProductUpdateContextValue,
} from '../home/product-update-context.js';
import {
  SupportCard,
  SupportFailClosed,
  SupportLoading,
  SupportSectionBlock,
  SupportSectionShell,
} from './support-section-shell.js';
import { SupportAppHostCacheCard, SupportDataRootCleanupCard } from './support-storage-tools.js';
import { SupportDiagnosticsSection } from './support-diagnostics-section.js';

export type RecoveryEntryContext = {
  readonly title: string;
  readonly detail?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly busy?: boolean;
};

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-002
function SupportProductUpdateCard({ update }: { update: ProductUpdateContextValue }) {
  const { t } = useTranslation();
  const status = update.status;
  const isPrepared = !update.attention && status?.phase === 'prepared';
  const needsRecovery = status?.recoveryAction === 'reopen-current' || status?.phase === 'recovery-required';
  const isCurrent = !update.attention && !update.busy && (status?.phase === 'current' || status?.phase === 'completed');
  const statusToneClass = update.railAttention
    ? 'font-medium text-[var(--nimi-status-danger)]'
    : isCurrent
      ? 'font-medium text-[var(--nimi-status-success)]'
      : 'text-[var(--nimi-text-secondary)]';
  const versionText = status?.currentVersion
    ? t('ProductUpdate.version', { version: status.currentVersion })
    : undefined;
  const candidateVersion = isPrepared ? status?.candidateVersion ?? null : null;
  const showInstallUnavailable = isPrepared && !status?.installationAvailable;
  const recoveryError = status?.recoveryError ?? null;
  const reasonCode = update.attention && status?.reason ? status.reason : null;

  return (
    <SupportCard
      title={t('ProductUpdate.sectionTitle')}
      description={versionText}
      testId="support-product-update"
      status={(
        <p role="status" data-testid="support-product-update-status" className={`text-xs ${statusToneClass}`}>
          {update.message}
        </p>
      )}
      action={
        isPrepared ? (
          <Button
            tone={status?.installationAvailable ? 'primary' : 'secondary'}
            size="sm"
            data-testid="support-product-update-action"
            onClick={update.open}
          >
            {t('ProductUpdate.update')}
          </Button>
        ) : needsRecovery ? (
          <Button
            tone="secondary"
            size="sm"
            data-testid="support-product-update-action"
            onClick={update.openDetails}
          >
            {t('ProductUpdate.details')}
          </Button>
        ) : (
          <Button
            tone="secondary"
            size="sm"
            data-testid="support-product-update-check"
            disabled={!update.checkAvailable}
            onClick={() => { void update.check(); }}
          >
            {t('ProductUpdate.check')}
          </Button>
        )
      }
    >
      {candidateVersion || showInstallUnavailable || recoveryError || reasonCode ? (
        <div className="space-y-2">
          {candidateVersion ? (
            <p className="text-xs text-[var(--nimi-text-secondary)]">
              {t('ProductUpdate.candidate', { version: candidateVersion })}
            </p>
          ) : null}
          {showInstallUnavailable ? (
            <p className="text-xs text-[var(--nimi-text-secondary)]">
              {t('ProductUpdate.installationUnavailable')}
            </p>
          ) : null}
          {recoveryError ? (
            <p role="alert" className="text-xs text-[var(--nimi-status-danger)]">
              {t(`ProductUpdate.reasons.${recoveryError}`)}
            </p>
          ) : null}
          {reasonCode ? (
            <details className="text-xs text-[var(--nimi-text-muted)]" data-testid="support-product-update-details">
              <summary className="cursor-pointer font-medium text-[var(--nimi-text-secondary)]">
                {t('ProductUpdate.details')}
              </summary>
              <code className="mt-1 block break-all">{reasonCode}</code>
            </details>
          ) : null}
        </div>
      ) : null}
    </SupportCard>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r028
// A gate describes its current failure. The stored control record cannot clear it.
export function SupportTroubleshooting({ recovery }: { recovery?: RecoveryEntryContext }) {
  const { t } = useTranslation();
  const commands = useDesktopRendererCommands();
  const reconnect = useDesktopFormalSessionRecovery();
  const update = useOptionalProductUpdate();
  const load = useCallback(() => commands.supportRepair.loadProductControlRecord(), [commands.supportRepair]);
  const control = useTypedProjection(load, { failClosedMessage: t('Support.repairProjectionUnavailable') });
  const loadDirs = useCallback(() => commands.supportRepair.loadStorageDirs(), [commands.supportRepair]);
  const dirs = useTypedProjection(loadDirs, { failClosedMessage: t('DataManagement.dataRootReadFailed') });
  const state = control.data;
  const copyKey = state ? NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[state.state] : null;
  const isHealthy = state?.state === 'ready_for_use' && !state.error && !state.record?.repair.reason;

  return (
    <SupportSectionShell
      hideHeader={Boolean(recovery)}
      title={t('Settings.menuTroubleshooting')}
      description={t('Support.recoveryDescription')}
      testId="support-troubleshooting"
    >
      {recovery ? (
        <SupportCard
          title={recovery.title}
          description={t('Support.gateStillBlocked')}
          testId="support-current-gate"
          action={
            recovery.onAction && recovery.actionLabel ? (
              <Button tone="secondary" size="sm" disabled={recovery.busy} onClick={recovery.onAction}>
                {recovery.actionLabel}
              </Button>
            ) : undefined
          }
        >
          {recovery.detail ? (
            <details className="text-xs text-[var(--nimi-text-secondary)]">
              <summary className="cursor-pointer font-medium text-[var(--nimi-text-primary)]">
                {t('Feedback.technicalDetails')}
              </summary>
              <p className="mt-2 break-all">{recovery.detail}</p>
            </details>
          ) : null}
        </SupportCard>
      ) : null}
      {control.status === 'loading' ? (
        <SupportLoading testId="support-control-loading" />
      ) : control.status === 'failed' || !state || !copyKey ? (
        <SupportFailClosed
          testId="support-control-failed"
          reason={control.error ?? t('Support.repairProjectionUnavailable')}
          onRetry={control.reload}
        />
      ) : recovery ? (
        <details
          className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 text-sm shadow-sm"
          data-testid="support-stored-record"
        >
          <summary className="cursor-pointer font-medium text-[var(--nimi-text-primary)]">
            {t('Support.storedRecord')}
          </summary>
          <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{t(`${copyKey}.title`)}</p>
          {state.error || state.record?.repair.reason ? (
            <p className="mt-2 break-words text-xs text-[var(--nimi-text-secondary)]" data-testid="support-record-reason">
              {state.error || state.record?.repair.reason}
            </p>
          ) : null}
        </details>
      ) : (
        <SupportCard
          title={t(`${copyKey}.title`)}
          description={isHealthy ? undefined : t(`${copyKey}.body`)}
          testId="support-control-state"
          status={
            isHealthy ? (
              <p className="text-xs font-medium text-[var(--nimi-status-success)]">
                {t(`${copyKey}.body`)}
              </p>
            ) : undefined
          }
        >
          {state.error || state.record?.repair.reason ? (
            <p className="break-words text-xs text-[var(--nimi-text-secondary)]">
              {state.error || state.record?.repair.reason}
            </p>
          ) : null}
        </SupportCard>
      )}
      {!recovery && reconnect ? (
        <SupportCard
          title={t('Support.localSessionTitle')}
          description={t('Support.localSessionDescription')}
          action={
            <Button tone="secondary" size="sm" data-testid="support-local-session-retry" onClick={reconnect}>
              {t('Bootstrap.localSessionRetry')}
            </Button>
          }
        />
      ) : null}
      {!recovery && update ? <SupportProductUpdateCard update={update} /> : null}
      {recovery ? <SupportAppHostCacheCard /> : null}
      <SupportSectionBlock
        title={t('Feedback.technicalDetails')}
        description={t('Support.diagnosticsDescription')}
        bareContent
      >
        <details className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-[var(--nimi-text-primary)]">
            {t('Support.diagnosticsTitle')}
          </summary>
          <div className="mt-4">
            <SupportDiagnosticsSection embedded />
          </div>
        </details>
      </SupportSectionBlock>
      <SupportSectionBlock
        title={t('Support.repairAdvancedCleanup')}
        description={t('Support.repairCleanupDescription')}
        bareContent
      >
        <details className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-[var(--nimi-text-primary)]">
            {t('Support.repairCleanupTitle')}
          </summary>
          <div className="mt-4 border-t border-[var(--nimi-border-subtle)] pt-4">
            <SupportDataRootCleanupCard embedded dirs={dirs.data ?? null} dirsError={dirs.error} />
          </div>
        </details>
      </SupportSectionBlock>
    </SupportSectionShell>
  );
}
