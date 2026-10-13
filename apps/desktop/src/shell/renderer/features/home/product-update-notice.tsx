import { useEffect, useState } from 'react';
import { Button, ConfirmDialog, IconButton, ProgressIndicator, Tooltip } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

const PILL_BASE_CLASS =
  'flex max-w-full flex-wrap items-center justify-end gap-x-2.5 gap-y-1 rounded-full border px-3 py-1.5 text-xs text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-base)]';

const PILL_TONE_CLASS = {
  quiet: 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]',
  accent:
    'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-panel))]',
  warning:
    'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-panel))]',
} as const;

const QUIET_SUCCESS_PHASES = new Set(['current', 'completed']);

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
  const attention = actionError || query.isError || status?.phase === 'failed' || status?.recoveryAction === 'reopen-current';
  const tone = attention ? 'warning' : prepared ? 'accent' : 'quiet';
  const leadingIcon = attention
    ? <TriangleAlert size={13} strokeWidth={1.8} className="shrink-0 text-[var(--nimi-status-warning)]" aria-hidden="true" />
    : busy
      ? <RefreshCw size={12} strokeWidth={1.8} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      : prepared
        ? <ArrowDownToLine size={13} strokeWidth={1.8} className="shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
        : <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${status && QUIET_SUCCESS_PHASES.has(status.phase) ? 'bg-[var(--nimi-status-success)] shadow-[0_0_6px_var(--nimi-status-success)]' : 'bg-[var(--nimi-text-muted)]'}`} />;
  const statusText = prepared && status?.candidateVersion ? t('ProductUpdate.candidate', { version: status.candidateVersion }) : message;
  return (
    <div data-testid="nimi-product-update" className="flex justify-end px-4 pb-1 pt-3">
      <div className={`${PILL_BASE_CLASS} ${PILL_TONE_CLASS[tone]}`}>
        {leadingIcon}
        <span className="font-medium tabular-nums text-[var(--nimi-text-primary)]">{t('ProductUpdate.version', { version: status?.currentVersion ?? '…' })}</span>
        <span role="status" aria-live="polite" className="min-w-0">{statusText}</span>
        {status?.recoveryAction === 'reopen-current' ? (
          <Button tone="secondary" size="sm" className="rounded-full" onClick={() => { void reopen(); }}>{t('ProductUpdate.reopen')}</Button>
        ) : null}
        {status?.recoveryError ? <span role="alert">{t(`ProductUpdate.reasons.${status.recoveryError}`)}</span> : null}
        {status?.phase === 'downloading' && status.totalBytes > 0 ? (
          <ProgressIndicator aria-label={t('ProductUpdate.download')} value={status.downloadedBytes} max={status.totalBytes} showValue className="w-24 gap-2" />
        ) : null}
        {prepared && !status.installationAvailable ? <span>{t('ProductUpdate.installationUnavailable')}</span> : null}
        {prepared && status.installationAvailable ? (
          <Button tone="primary" size="sm" className="rounded-full" onClick={() => setConfirmedRelease(status.releaseId)}>{t('ProductUpdate.restart')}</Button>
        ) : null}
        {prepared ? (
          <Button tone="ghost" size="sm" className="rounded-full" onClick={() => setDeferredRelease(status.releaseId)}>{t('ProductUpdate.later')}</Button>
        ) : null}
        {cancelable ? (
          <Tooltip content={t('ProductUpdate.cancel')} placement="bottom">
            <IconButton tone="ghost" size="sm" className="rounded-full" aria-label={t('ProductUpdate.cancel')}
              icon={<X size={13} strokeWidth={1.8} />} onClick={() => { void cancel(); }} />
          </Tooltip>
        ) : !busy && !prepared && status?.checkAvailable ? (
          <Tooltip content={t('ProductUpdate.check')} placement="bottom">
            <IconButton tone="ghost" size="sm" className="rounded-full" aria-label={t('ProductUpdate.check')}
              icon={<RefreshCw size={13} strokeWidth={1.8} />} onClick={() => { void check(); }} />
          </Tooltip>
        ) : null}
        {reason && status?.phase === 'failed' ? (
          <details className="w-full"><summary className="cursor-pointer">{t('ProductUpdate.details')}</summary><code className="block break-all">{reason}</code></details>
        ) : null}
      </div>
      <ConfirmDialog open={confirmedRelease !== null} title={t('ProductUpdate.confirmTitle')} message={t('ProductUpdate.confirmBody')}
        confirmLabel={t('ProductUpdate.restart')} cancelLabel={t('ProductUpdate.later')} confirmTone="primary"
        onConfirm={() => { void install(); }} onClose={() => setConfirmedRelease(null)} />
    </div>
  );
}
