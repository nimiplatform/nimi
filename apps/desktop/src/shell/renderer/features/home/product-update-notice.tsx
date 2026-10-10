import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-002
export function ProductUpdateNotice() {
  const { t } = useTranslation();
  const { app } = useDesktopRendererBindings();
  const [actionError, setActionError] = useState(false);
  const [deferredRelease, setDeferredRelease] = useState<string | null>(null);
  const [confirmedRelease, setConfirmedRelease] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['nimi-product-update'], queryFn: () => app.commands.productUpdate.status(),
    refetchInterval: (state) => ['checking', 'downloading', 'verifying', 'quiescing', 'handoff', 'awaiting-activation'].includes(state.state.data?.phase ?? '') ? 1_000 : 30_000, retry: false });
  useEffect(() => { void app.commands.productUpdate.homeReady().then(() => query.refetch()).catch(() => setActionError(true)); }, [app.commands.productUpdate]);
  const status = query.data;
  const busy = status && ['checking', 'downloading', 'verifying', 'quiescing', 'handoff', 'awaiting-activation'].includes(status.phase);
  const cancelable = status && ['checking', 'downloading', 'verifying'].includes(status.phase);
  const reason = status?.reason;
  const message = actionError || query.isError ? t('ProductUpdate.bridgeUnavailable')
    : reason && reason !== 'UPDATE_INSTALLER_NOT_CONNECTED' ? t(`ProductUpdate.reasons.${reason}`, { defaultValue: t('ProductUpdate.failed') })
    : status ? t(`ProductUpdate.phases.${status.phase}`) : t('ProductUpdate.loading');
  const check = async () => {
    setActionError(false);
    setDeferredRelease(null);
    try { await app.commands.productUpdate.check(); await query.refetch(); }
    catch { setActionError(true); }
  };
  const cancel = async () => {
    try { await app.commands.productUpdate.cancel(); await query.refetch(); }
    catch { setActionError(true); }
  };
  const reopen = async () => {
    setActionError(false);
    try { await app.commands.productUpdate.reopenCurrentVersion(); await query.refetch(); }
    catch { setActionError(true); }
  };
  const prepared = status?.phase === 'prepared' && deferredRelease !== status.releaseId;
  const install = async () => {
    const releaseId = confirmedRelease;
    setConfirmedRelease(null);
    if (!status?.installationAvailable || !releaseId || status.releaseId !== releaseId) { await query.refetch(); return; }
    try { await app.commands.productUpdate.install(releaseId); await query.refetch(); }
    catch { setActionError(true); }
  };
  return (
    <div data-testid="nimi-product-update" className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-4 py-2 text-xs text-[var(--nimi-text-secondary)]">
      <span>{t('ProductUpdate.version', { version: status?.currentVersion ?? '…' })}</span>
      <span role="status" aria-live="polite">{message}</span>
      {status?.recoveryAction === 'reopen-current' ? <>
        <span>{t('ProductUpdate.reopenRequired')}</span>
        <button type="button" onClick={() => { void reopen(); }} className="underline">{t('ProductUpdate.reopen')}</button>
      </> : null}
      {status?.recoveryError ? <span role="alert">{t(`ProductUpdate.reasons.${status.recoveryError}`)}</span> : null}
      {status?.phase === 'downloading' && status.totalBytes > 0 ? (
        <progress aria-label={t('ProductUpdate.download')} value={status.downloadedBytes} max={status.totalBytes} className="h-1 w-20" />
      ) : null}
      {status?.candidateVersion && prepared ? <span>{t('ProductUpdate.candidate', { version: status.candidateVersion })}</span> : null}
      {prepared && !status.installationAvailable ? <span>{t('ProductUpdate.installationUnavailable')}</span> : null}
      {prepared && status.installationAvailable ? <button type="button" onClick={() => setConfirmedRelease(status.releaseId)} className="underline">{t('ProductUpdate.restart')}</button> : null}
      {prepared ? <button type="button" onClick={() => setDeferredRelease(status.releaseId)} className="underline">{t('ProductUpdate.later')}</button> : null}
      {cancelable ? <button type="button" onClick={() => { void cancel(); }} className="underline">{t('ProductUpdate.cancel')}</button>
        : !busy && status?.checkAvailable ? <button type="button" onClick={() => { void check(); }} className="underline">{t('ProductUpdate.check')}</button> : null}
      {reason && status?.phase === 'failed' ? <details><summary>{t('ProductUpdate.details')}</summary><code>{reason}</code></details> : null}
      <ConfirmDialog open={confirmedRelease !== null} title={t('ProductUpdate.confirmTitle')} message={t('ProductUpdate.confirmBody')}
        confirmLabel={t('ProductUpdate.restart')} cancelLabel={t('ProductUpdate.later')} confirmTone="primary"
        onConfirm={() => { void install(); }} onClose={() => setConfirmedRelease(null)} />
    </div>
  );
}
