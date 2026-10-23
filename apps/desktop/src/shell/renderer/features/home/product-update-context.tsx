import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, OverlayShell, ProgressIndicator, cn } from '@nimiplatform/kit/ui';
import { CircleAlert, CircleCheck, Download, Info, LoaderCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProductUpdateStatus } from '../../../shared/product-update.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { ProductRetentionDialog } from './product-retention-dialog.js';

const QUERY_KEY = ['nimi-product-update'];
const BUSY_PHASES = new Set(['checking', 'downloading', 'verifying', 'quiescing', 'handoff', 'awaiting-activation']);
const CANCELABLE_PHASES = new Set(['checking', 'downloading', 'verifying']);

type DialogTone = 'success' | 'busy' | 'attention' | 'prepared' | 'neutral';
const DIALOG_TONE_PRESENTATION: Record<DialogTone, { icon: LucideIcon; iconClassName: string }> = {
  success: { icon: CircleCheck, iconClassName: 'text-[var(--nimi-status-success)]' },
  busy: { icon: LoaderCircle, iconClassName: 'animate-spin motion-reduce:animate-none text-[var(--nimi-status-info)]' },
  attention: { icon: CircleAlert, iconClassName: 'text-[var(--nimi-status-danger)]' },
  prepared: { icon: Download, iconClassName: 'text-[var(--nimi-status-info)]' },
  neutral: { icon: Info, iconClassName: 'text-[var(--nimi-text-muted)]' },
};

type ProductUpdateContextValue = {
  status: ProductUpdateStatus | undefined;
  busy: boolean;
  attention: boolean;
  railVisible: boolean;
  checkAvailable: boolean;
  message: string;
  homeReady: () => void;
  check: () => Promise<void>;
  open: () => void;
  openDetails: () => void;
};
const ProductUpdateContext = createContext<ProductUpdateContextValue | null>(null);

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-002
export function ProductUpdateProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const { app } = useDesktopRendererBindings();
  const client = useQueryClient();
  const port = app.commands.productUpdate;
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualCheck, setManualCheck] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [confirmedRelease, setConfirmedRelease] = useState<string | null>(null);
  const [acknowledgedRelease, setAcknowledgedRelease] = useState<string | null>(null);
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => port.status(), enabled: ready, retry: false,
    refetchInterval: state => BUSY_PHASES.has(state.state.data?.phase ?? '') ? 1_000 : 30_000 });
  const status = query.data;
  const busy = submitting || BUSY_PHASES.has(status?.phase ?? '');
  const attention = actionError || query.isError || status?.phase === 'failed'
    || status?.phase === 'recovery-required' || status?.recoveryAction === 'reopen-current';
  const completed = !actionError && !query.isError && status?.phase === 'completed'
    && Boolean(status.releaseId) && acknowledgedRelease !== status.releaseId;
  const message = actionError || query.isError ? t('ProductUpdate.bridgeUnavailable')
    : manualCheck && submitting ? t('ProductUpdate.phases.checking')
    : status?.reason && status.reason !== 'UPDATE_INSTALLER_NOT_CONNECTED'
      ? t(`ProductUpdate.reasons.${status.reason}`, { defaultValue: t('ProductUpdate.failed') })
      : status ? t(`ProductUpdate.phases.${status.phase}`) : t('ProductUpdate.loading');
  const checkAvailable = ready && !busy && (status?.checkAvailable ?? true);
  const dialogTone: DialogTone = completed || (!busy && !attention && status?.phase === 'current') ? 'success'
    : attention ? 'attention'
    : busy ? 'busy'
    : status?.phase === 'prepared' ? 'prepared'
    : 'neutral';
  const DialogToneIcon = DIALOG_TONE_PRESENTATION[dialogTone].icon;

  const homeReady = useCallback(() => {
    if (started.current) return;
    started.current = true;
    void port.homeReady().then(value => {
      client.setQueryData(QUERY_KEY, value);
      setReady(true);
    }).catch(() => { setActionError(true); setReady(true); });
  }, [client, port]);

  useEffect(() => {
    if (!manualCheck || busy || !status) return;
    setManualCheck(false);
    setFeedbackOpen(status.phase !== 'prepared' && status.phase !== 'completed');
  }, [manualCheck, busy, status]);

  const check = async () => {
    if (!checkAvailable) return;
    setActionError(false);
    setFeedbackOpen(false);
    setManualCheck(true);
    setSubmitting(true);
    try { client.setQueryData(QUERY_KEY, await port.check()); }
    catch { setActionError(true); setManualCheck(false); setFeedbackOpen(true); }
    finally { setSubmitting(false); }
  };
  const open = () => {
    if (!attention && status?.phase === 'prepared' && status.installationAvailable && status.releaseId) {
      setFeedbackOpen(false);
      setConfirmedRelease(status.releaseId);
    } else { setFeedbackOpen(true); }
  };
  const closeFeedback = () => {
    if (completed) setAcknowledgedRelease(status!.releaseId);
    setFeedbackOpen(false);
  };
  const install = async () => {
    const releaseId = confirmedRelease;
    setConfirmedRelease(null);
    // A changed candidate requires a new confirmation, never stale consent.
    if (!status?.installationAvailable || status.phase !== 'prepared' || !releaseId || status.releaseId !== releaseId) {
      await query.refetch(); return;
    }
    setActionError(false);
    setSubmitting(true);
    try { client.setQueryData(QUERY_KEY, await port.install(releaseId)); }
    catch { setActionError(true); setFeedbackOpen(true); }
    finally { setSubmitting(false); }
  };
  const act = async (action: 'cancel' | 'reopenCurrentVersion') => {
    setActionError(false);
    setSubmitting(true);
    try { client.setQueryData(QUERY_KEY, await port[action]()); }
    catch { setActionError(true); }
    finally { setSubmitting(false); }
  };

  return <ProductUpdateContext.Provider value={{ status, busy, attention, checkAvailable, message, homeReady, check, open, openDetails: () => setFeedbackOpen(true),
    railVisible: ready && (busy || attention || status?.phase === 'prepared') }}>
    {children}
    <ConfirmDialog open={confirmedRelease !== null} title={t('ProductUpdate.confirmTitle')} message={t('ProductUpdate.confirmBody')}
      confirmLabel={t('ProductUpdate.restart')} cancelLabel={t('ProductUpdate.later')} confirmTone="primary"
      onConfirm={() => { void install(); }} onClose={() => setConfirmedRelease(null)} />
    <OverlayShell open={feedbackOpen || completed} size="sm" data-testid="product-update-dialog"
      onClose={closeFeedback} title={t(completed ? 'ProductUpdate.completedTitle'
        : !busy && !attention && status?.phase === 'current' ? 'ProductUpdate.currentTitle' : 'ProductUpdate.check')}
      footer={<div className="flex justify-end gap-3">
        {status?.maintenanceAvailable ? <ProductRetentionDialog port={port} disabled={busy} /> : null}
        {!attention && status?.phase === 'prepared' && status.installationAvailable ? <Button onClick={open}>{t('ProductUpdate.update')}</Button> : null}
        {status?.recoveryAction === 'reopen-current' ? <Button disabled={submitting} onClick={() => { void act('reopenCurrentVersion'); }}>{t('ProductUpdate.reopen')}</Button> : null}
        {CANCELABLE_PHASES.has(status?.phase ?? '') ? <Button disabled={submitting} onClick={() => { void act('cancel'); }}>{t('ProductUpdate.cancel')}</Button> : null}
        {attention && checkAvailable ? <Button onClick={() => { void check(); }}>{t('ProductUpdate.check')}</Button> : null}
        <Button tone="primary" onClick={closeFeedback}>{t('ProductUpdate.dismiss')}</Button>
      </div>}>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <DialogToneIcon aria-hidden className={cn('mt-0.5 h-5 w-5 shrink-0', DIALOG_TONE_PRESENTATION[dialogTone].iconClassName)} />
          <div className="min-w-0 space-y-1.5">
            <p className="font-medium leading-5 text-[var(--nimi-text-primary)]">{t('ProductUpdate.version', { version: status?.currentVersion ?? '…' })}</p>
            <p role="status" aria-live="polite" className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{completed ? t('ProductUpdate.completedBody') : message}</p>
            {status?.phase === 'prepared' && !status.installationAvailable
              ? <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{t('ProductUpdate.installationUnavailable')}</p> : null}
            {status?.recoveryError
              ? <p role="alert" className="text-sm leading-6 text-[var(--nimi-status-danger)]">{t(`ProductUpdate.reasons.${status.recoveryError}`)}</p> : null}
            {attention && status?.reason
              ? <details className="text-xs text-[var(--nimi-text-muted)]"><summary className="cursor-pointer">{t('ProductUpdate.details')}</summary><code className="block break-all">{status.reason}</code></details> : null}
          </div>
        </div>
        {status?.phase === 'downloading' && status.totalBytes > 0 ? <ProgressIndicator aria-label={t('ProductUpdate.download')}
          value={status.downloadedBytes} max={status.totalBytes} showValue /> : null}
      </div>
    </OverlayShell>
  </ProductUpdateContext.Provider>;
}

export function useProductUpdate() {
  const value = useContext(ProductUpdateContext);
  if (!value) throw new Error('ProductUpdateProvider is required');
  return value;
}
