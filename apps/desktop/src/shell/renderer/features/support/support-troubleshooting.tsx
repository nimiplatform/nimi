import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, useTypedProjection } from '@nimiplatform/kit/ui';
import { NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY } from '@nimiplatform/sdk/runtime';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useDesktopFormalSessionRecovery } from '../../app-shell/routes/desktop-formal-session.js';
import { SupportCard, SupportFailClosed, SupportLoading, SupportSectionShell } from './support-section-shell.js';
import { SupportAppHostCacheCard, SupportDataRootCleanupCard } from './support-storage-tools.js';
import { SupportDiagnosticsSection } from './support-diagnostics-section.js';

export type RecoveryEntryContext = {
  readonly title: string;
  readonly detail?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly busy?: boolean;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r028
// A gate describes its current failure. The stored control record cannot clear it.
export function SupportTroubleshooting({ recovery }: { recovery?: RecoveryEntryContext }) {
  const { t } = useTranslation();
  const commands = useDesktopRendererCommands();
  const reconnect = useDesktopFormalSessionRecovery();
  const load = useCallback(() => commands.supportRepair.loadProductControlRecord(), [commands.supportRepair]);
  const control = useTypedProjection(load, { failClosedMessage: t('Support.repairProjectionUnavailable') });
  const loadDirs = useCallback(() => commands.supportRepair.loadStorageDirs(), [commands.supportRepair]);
  const dirs = useTypedProjection(loadDirs, { failClosedMessage: t('DataManagement.dataRootReadFailed') });
  const state = control.data;
  const copyKey = state ? NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[state.state] : null;
  return <SupportSectionShell hideHeader={Boolean(recovery)} title={t('Settings.menuTroubleshooting')} testId="support-troubleshooting">
    {recovery ? <SupportCard title={recovery.title} testId="support-current-gate">
      <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Support.gateStillBlocked')}</p>
      {recovery.detail ? <details className="mt-3 text-xs"><summary>{t('Feedback.technicalDetails')}</summary><p className="mt-2 break-all">{recovery.detail}</p></details> : null}
      {recovery.onAction && recovery.actionLabel ? <Button className="mt-3" disabled={recovery.busy} onClick={recovery.onAction}>{recovery.actionLabel}</Button> : null}
    </SupportCard> : null}
    {control.status === 'loading' ? <SupportLoading testId="support-control-loading" /> : control.status === 'failed' || !state || !copyKey ? (
      <SupportFailClosed testId="support-control-failed" reason={control.error ?? t('Support.repairProjectionUnavailable')} onRetry={control.reload} />
    ) : recovery ? (
      <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-4 text-sm" data-testid="support-stored-record">
        <summary>{t('Support.storedRecord')}</summary>
        <p className="mt-2 text-[var(--nimi-text-secondary)]">{t(`${copyKey}.title`)}</p>
        {state.error || state.record?.repair.reason ? <p className="mt-2 break-words text-xs" data-testid="support-record-reason">{state.error || state.record?.repair.reason}</p> : null}
      </details>
    ) : <SupportCard title={t(`${copyKey}.title`)} description={t(`${copyKey}.body`)} testId="support-control-state">
      {state.error || state.record?.repair.reason ? <p className="break-words text-sm">{state.error || state.record?.repair.reason}</p> : null}
    </SupportCard>}
    {!recovery && reconnect ? <SupportCard title={t('Support.localSessionTitle')} description={t('Support.localSessionDescription')}>
      <Button data-testid="support-local-session-retry" onClick={reconnect}>{t('Bootstrap.localSessionRetry')}</Button>
    </SupportCard> : null}
    {recovery ? <SupportAppHostCacheCard /> : null}
    <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-4">
      <summary className="cursor-pointer text-sm font-medium">{t('Feedback.technicalDetails')}</summary>
      <div className="mt-4"><SupportDiagnosticsSection embedded /></div>
    </details>
    <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-4">
      <summary className="cursor-pointer text-sm font-medium">{t('Support.repairAdvancedCleanup')}</summary>
      <div className="mt-4"><SupportDataRootCleanupCard dirs={dirs.data ?? null} dirsError={dirs.error} /></div>
    </details>
  </SupportSectionShell>;
}
