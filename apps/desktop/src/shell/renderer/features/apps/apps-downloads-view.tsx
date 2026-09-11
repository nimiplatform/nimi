import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronsUp, Download, GripVertical, Pause, Play } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, IconButton, InlineAlert, ScrollArea, StatusBadge, Surface, Tooltip } from '@nimiplatform/kit/ui';
import { AppPackageJobKind, AppPackageJobPhase, AppPackageSourceClass, type AppPackageJob, type ApprovedAppCatalogTarget } from '@nimiplatform/sdk/runtime/wire-types';
import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import { DownloadMetrics } from '../../components/download-metrics.js';
import { formatBytes } from '../../components/download-format.js';
import { useAppsDownloads, type AppsDownloadsContextValue } from './apps-downloads-context.js';
import { packageJobIsTerminal, packageJobKey, timestampMilliseconds, type AppDownloadCommand } from './apps-downloads-observer.js';
import { AppArtworkIcon } from './apps-card-visuals.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

export function isAppDownloadJob(job: AppPackageJob): boolean {
  return [AppPackageSourceClass.VERIFIED, AppPackageSourceClass.USER_IMPORTED].includes(job.sourceClass) && [AppPackageJobKind.INSTALL, AppPackageJobKind.UPDATE].includes(job.kind);
}

export function catalogTargetMatchesJob(target: ApprovedAppCatalogTarget | null, job: AppPackageJob): boolean {
  const selected = new TextEncoder().encode(job.targetRef);
  return Boolean(target && selected.length === target.approvedTargetSelector.length
    && selected.every((byte, index) => byte === target.approvedTargetSelector[index]));
}

export function appDownloadPhase(job: AppPackageJob): string {
  switch (job.phase) {
    case AppPackageJobPhase.QUEUED: return 'queued';
    case AppPackageJobPhase.DOWNLOADING: return 'downloading';
    case AppPackageJobPhase.PAUSED: return 'paused';
    case AppPackageJobPhase.VERIFYING: return 'verifying';
    case AppPackageJobPhase.STAGING: return 'staging';
    case AppPackageJobPhase.COMMITTING: return 'committing';
    case AppPackageJobPhase.COMPLETED: return 'completed';
    case AppPackageJobPhase.FAILED: return 'failed';
    case AppPackageJobPhase.CANCELED: return 'canceled';
    default: return 'processing';
  }
}

function jobName(job: AppPackageJob): string { return job.displayName || job.appId; }
export function failedDownloadNeedsAttention(job: AppPackageJob, jobs: readonly AppPackageJob[]): boolean {
  return job.phase === AppPackageJobPhase.FAILED && !jobs.some((next) => next.appId === job.appId && next.sourceClass === job.sourceClass
    && timestampMilliseconds(next.startedAt) > timestampMilliseconds(job.startedAt));
}
function jobTone(job: AppPackageJob): 'info' | 'warning' | 'danger' | 'success' | 'neutral' {
  return job.phase === AppPackageJobPhase.FAILED ? 'danger' : job.phase === AppPackageJobPhase.PAUSED ? 'warning'
    : job.phase === AppPackageJobPhase.COMPLETED ? 'success' : job.phase === AppPackageJobPhase.DOWNLOADING ? 'info' : 'neutral';
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-home-009a
export function AppsDownloadsNavigation({ onOpen }: { readonly onOpen: () => void }): ReactElement | null {
  const downloads = useAppsDownloads();
  const { t } = useTranslation();
  const jobs = downloads?.jobs.filter(isAppDownloadJob) ?? [];
  const count = jobs.filter((job) => !packageJobIsTerminal(job)).length;
  const failed = jobs.filter((job) => failedDownloadNeedsAttention(job, jobs)).length;
  if (!downloads || (count === 0 && failed === 0)) return null;
  const title = t(downloads.status === 'unavailable' ? 'Apps.downloads.navigationStale' : 'Apps.downloads.navigation', { count });
  return <Tooltip content={title} placement="right">
    <div className="relative">
      <IconButton data-testid="apps-downloads-global-entry" aria-label={title} size="sm" icon={<Download className="h-4 w-4" aria-hidden="true" />}
        onClick={() => { downloads.openDownloads(); onOpen(); }} />
      <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-1 text-[11px] leading-4 text-[var(--nimi-action-primary-text)]">{count || '!'}</span>
    </div>
  </Tooltip>;
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
export function AppsDownloadsView({ downloads, entries, onViewApp, onRetry }: {
  readonly downloads: AppsDownloadsContextValue;
  readonly entries: readonly DesktopAppsEntry[];
  readonly onViewApp: (job: AppPackageJob) => void;
  readonly onRetry: (job: AppPackageJob) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [recentOpen, setRecentOpen] = useState(false);
  const [cancelJob, setCancelJob] = useState<AppPackageJob | null>(null);
  const [feedback, setFeedback] = useState('');
  const [phaseFeedback, setPhaseFeedback] = useState('');
  const [actionErrors, setActionErrors] = useState<string[]>([]);
  const [sourceError, setSourceError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const draggedJobId = useRef<string | null>(null);
  const lastFocusedJob = useRef<string | null>(null);
  const focusRevision = useRef(0);
  const previousPhases = useRef(new Map<string, AppPackageJobPhase>());
  const jobs = downloads.jobs.filter(isAppDownloadJob);
  const selected = jobs.find((job) => packageJobKey(job) === downloads.selectedJobId);
  const active = jobs.filter((job) => job.phase === AppPackageJobPhase.DOWNLOADING);
  const queued = jobs.filter((job) => job.sourceClass === AppPackageSourceClass.VERIFIED && job.phase === AppPackageJobPhase.QUEUED).sort((a, b) => a.queuePosition - b.queuePosition);
  const paused = jobs.filter((job) => job.sourceClass === AppPackageSourceClass.VERIFIED && job.phase === AppPackageJobPhase.PAUSED);
  const failed = jobs.filter((job) => failedDownloadNeedsAttention(job, jobs));
  const processing = jobs.filter((job) => !packageJobIsTerminal(job) && (job.sourceClass === AppPackageSourceClass.USER_IMPORTED || ![AppPackageJobPhase.QUEUED, AppPackageJobPhase.DOWNLOADING, AppPackageJobPhase.PAUSED].includes(job.phase)));
  const recent = jobs.filter((job) => packageJobIsTerminal(job) && !failedDownloadNeedsAttention(job, jobs))
    .sort((a, b) => timestampMilliseconds(b.completedAt) - timestampMilliseconds(a.completedAt));
  const detail = selected ?? (downloads.selectedJobId ? undefined : active[0] ?? processing[0] ?? failed[0] ?? queued[0] ?? paused[0] ?? recent[0]);
  const busy = downloads.pendingIds.length > 0;
  const unavailable = downloads.status !== 'ready';
  const blocked = busy || unavailable;

  useEffect(() => {
    if (downloads.selectedJobId) headingRef.current?.focus();
  }, [downloads.selectedJobId]);

  useEffect(() => {
    const changed = jobs.filter((job) => previousPhases.current.get(packageJobKey(job)) !== job.phase);
    if (previousPhases.current.size && changed.length) setPhaseFeedback(changed.map((job) => `${jobName(job)}: ${t(`Apps.downloads.phase.${appDownloadPhase(job)}`)}`).join('. '));
    previousPhases.current = new Map(jobs.map((job) => [packageJobKey(job), job.phase]));
  }, [jobs, t]);

  const restoreFocus = (jobId: string | null) => requestAnimationFrame(() => {
    const candidates = [downloads.selectedJobId === jobId ? headingRef.current : null, jobId ? rowRefs.current.get(jobId) : null, pageHeadingRef.current];
    for (const candidate of candidates) {
      if (candidate?.isConnected && candidate.getClientRects().length) { candidate.focus(); return; }
    }
  });

  const select = (job: AppPackageJob) => {
    ++focusRevision.current;
    lastFocusedJob.current = packageJobKey(job);
    downloads.selectJob(packageJobKey(job));
  };
  const back = () => {
    ++focusRevision.current;
    const jobId = downloads.selectedJobId ?? lastFocusedJob.current;
    if (selected && packageJobIsTerminal(selected)) setRecentOpen(true);
    downloads.selectJob(null);
    restoreFocus(jobId);
  };
  const execute = async (command: AppDownloadCommand, targets: readonly AppPackageJob[], before?: Uint8Array) => {
    const focusAtStart = focusRevision.current;
    setActionErrors([]);
    const results = await downloads.observer.control(command, targets, before);
    const errors = results.filter((result) => result.error).map((result) => {
      const job = targets.find((candidate) => packageJobKey(candidate) === result.jobId);
      return `${job ? jobName(job) : result.jobId}: ${result.error}`;
    });
    setActionErrors(errors);
    if (results.length) setFeedback(t('Apps.downloads.actionResult', { count: results.length - errors.length, failed: errors.length }));
    if (downloads.observer.getSnapshot().jobs.some((job) => packageJobIsTerminal(job) && targets.some((target) => packageJobKey(target) === packageJobKey(job)))) setRecentOpen(true);
    if (focusRevision.current === focusAtStart) restoreFocus(targets[0] ? packageJobKey(targets[0]) : null);
    return errors.length === 0 && results.length > 0;
  };
  const cancel = (job: AppPackageJob) => {
    if (Number(job.bytesCompleted) > 0) setCancelJob(job);
    else void execute('cancel', [job]);
  };
  const actions = (job: AppPackageJob) => <div className="flex flex-wrap gap-2">
    {job.sourceClass === AppPackageSourceClass.VERIFIED && [AppPackageJobPhase.QUEUED, AppPackageJobPhase.DOWNLOADING].includes(job.phase) ? <Button size="sm" disabled={blocked} leadingIcon={<Pause className="h-4 w-4" aria-hidden="true" />}
      aria-label={t('Apps.downloads.pauseNamed', { app: jobName(job) })} onClick={() => void execute('pause', [job])}>{t('Apps.downloads.pause')}</Button> : null}
    {job.phase === AppPackageJobPhase.PAUSED ? <Button tone="primary" size="sm" disabled={blocked} leadingIcon={<Play className="h-4 w-4" aria-hidden="true" />}
      aria-label={t('Apps.downloads.resumeNamed', { app: jobName(job) })} onClick={() => void execute('resume', [job])}>{t('Apps.downloads.resume')}</Button> : null}
    {job.cancelable && !packageJobIsTerminal(job) ? <Button tone="ghost" size="sm" disabled={blocked} loading={downloads.pendingIds.includes(packageJobKey(job))}
      aria-label={t('Apps.downloads.cancelNamed', { app: jobName(job) })} onClick={() => cancel(job)}>{t('Apps.downloads.cancel')}</Button> : null}
    {failedDownloadNeedsAttention(job, jobs) ? <Button size="sm" disabled={blocked} onClick={() => onRetry(job)}>{t(job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'Apps.localImport.retry' : 'Apps.downloads.retry')}</Button> : null}
    {packageJobIsTerminal(job) ? <Button tone="ghost" size="sm" onClick={() => onViewApp(job)}>{t('Apps.downloads.viewApp')}</Button> : null}
  </div>;
  const metrics = (job: AppPackageJob) => <DownloadMetrics name={jobName(job)} received={Number(job.bytesCompleted)} total={job.bytesTotal === undefined ? undefined : Number(job.bytesTotal)}
    speed={Number(job.speedBytesPerSec)} eta={Number(job.etaSeconds)} observedAt={timestampMilliseconds(job.progressObservedAt)}
    available={!unavailable} transferring={job.phase === AppPackageJobPhase.DOWNLOADING}
    idleLabel={t('Apps.downloads.saved')} />;
  const row = (job: AppPackageJob, order = false) => {
    const id = packageJobKey(job);
    const position = queued.findIndex((candidate) => packageJobKey(candidate) === id);
    return <li key={id} data-testid={`app-download-job-${id}`} className="flex flex-wrap items-center gap-2 border-b border-[var(--nimi-border-subtle)] px-3 py-2 last:border-b-0"
      draggable={order && !blocked} onDragStart={() => { draggedJobId.current = id; }} onDragEnd={() => { draggedJobId.current = null; }}
      onDragOver={(event) => { if (order && !blocked) event.preventDefault(); }} onDrop={(event) => {
        event.preventDefault();
        const dragged = queued.find((candidate) => packageJobKey(candidate) === draggedJobId.current);
        draggedJobId.current = null;
        if (!blocked && order && dragged && packageJobKey(dragged) !== id) void execute('reorder', [dragged], job.jobId);
      }}>
      {order ? <span className="flex items-center gap-1 text-xs tabular-nums text-[var(--nimi-text-muted)]"><GripVertical className="h-4 w-4" aria-hidden="true" />{job.queuePosition || '—'}</span> : null}
      <AppArtworkIcon appId={job.appId} displayName={jobName(job)} size="sm" />
      <Button tone="ghost" size="sm" className="min-w-0 flex-1 justify-start px-1 text-left"
        ref={(node) => { if (node) rowRefs.current.set(id, node); else rowRefs.current.delete(id); }}
        aria-label={t('Apps.downloads.detailsNamed', { app: jobName(job) })} onClick={() => select(job)}>
        <span className="flex min-w-0 flex-col items-start"><span className="max-w-full truncate font-semibold">{jobName(job)}</span>
          <span className="whitespace-normal text-xs font-normal text-[var(--nimi-text-secondary)]">{job.previousVersion ? `${job.previousVersion} → ` : ''}{job.targetVersion} · {job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? `${t('Apps.localImport.localSource')} · ` : ''}{t(`Apps.downloads.phase.${appDownloadPhase(job)}`)}</span></span>
      </Button>
      {order ? <div className="flex items-center gap-1">
        <IconButton size="sm" disabled={blocked || position <= 0} icon={<ChevronsUp className="h-4 w-4" aria-hidden="true" />} aria-label={t('Apps.downloads.nextNamed', { app: jobName(job) })}
          onClick={() => void execute('reorder', [job], queued[0]?.jobId)} />
        <IconButton size="sm" disabled={blocked || position <= 0} icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />} aria-label={t('Apps.downloads.upNamed', { app: jobName(job) })}
          onClick={() => void execute('reorder', [job], queued[position - 1]?.jobId)} />
        <IconButton size="sm" disabled={blocked || position === queued.length - 1} icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />} aria-label={t('Apps.downloads.downNamed', { app: jobName(job) })}
          onClick={() => void execute('reorder', [job], queued[position + 2]?.jobId ?? new Uint8Array())} />
      </div> : <StatusBadge tone={jobTone(job)}>{t(`Apps.downloads.phase.${appDownloadPhase(job)}`)}</StatusBadge>}
    </li>;
  };
  const group = (label: string, groupJobs: readonly AppPackageJob[], order = false) => {
    if (groupJobs.length === 0) return null;
    return (
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t(`Apps.downloads.${label}`)}
          <span className="text-xs font-normal tabular-nums text-[var(--nimi-text-secondary)]">{groupJobs.length}</span>
        </h3>
        <Surface tone="card" padding="none" className="overflow-hidden rounded-lg">
          <ul>
            {groupJobs.map((job) => row(job, order))}
          </ul>
        </Surface>
      </section>
    );
  };
  const matchingEntry = detail ? entries.find((entry) => entry.identity.appId === detail.appId && entry.identity.sourceClass === (detail.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'user_imported' : 'verified')) : undefined;
  const catalog = detail && catalogTargetMatchesJob(matchingEntry?.catalogTarget ?? null, detail) ? matchingEntry?.catalogTarget : null;

  return <div className="flex min-h-0 flex-1 flex-col" data-testid="apps-downloads-view">
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 py-4">
      <div><h1 ref={pageHeadingRef} tabIndex={-1} className="text-xl font-semibold text-[var(--nimi-text-primary)] outline-none">{t('Apps.downloads.title')}</h1>
        <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t('Apps.downloads.summary', { downloading: active.length, processing: processing.length, queued: queued.length })}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={blocked || active.length + queued.length === 0} onClick={() => void execute('pause', [...queued, ...active])}>{t('Apps.downloads.pauseAll')}</Button>
        <Button size="sm" disabled={blocked || paused.length === 0} onClick={() => void execute('resume', paused)}>{t('Apps.downloads.resumeAll')}</Button>
      </div>
    </header>
    <ScrollArea className="min-h-0 flex-1" contentClassName="px-4 pb-4">
      {downloads.status === 'unavailable' ? <InlineAlert tone="warning" className="mb-4" action={<Button size="sm" onClick={() => void downloads.observer.refresh()}>{t('Apps.downloads.refresh')}</Button>}>{t('Apps.downloads.disconnected')}</InlineAlert> : null}
      {actionErrors.length ? <InlineAlert tone="danger" className="mb-4"><p>{t('Apps.downloads.controlFailed')}</p><ul>{actionErrors.map((error, index) => <li className="break-words text-xs" key={index}>{error}</li>)}</ul></InlineAlert> : null}
      {sourceError ? <InlineAlert tone="warning" className="mb-4">{sourceError}</InlineAlert> : null}
      <div className="sr-only" role="status" aria-live="polite">{feedback} {phaseFeedback}</div>
      {downloads.status === 'loading' ? <p className="py-4 text-sm text-[var(--nimi-text-secondary)]">{t('Apps.downloads.loading')}</p> : null}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,.8fr)]">
        <div className={`min-w-0 space-y-4 ${selected ? 'hidden xl:block' : ''}`}>
          {active.length ? <section><h3 className="mb-2 text-sm font-semibold">{t('Apps.downloads.active')}</h3>{active.map((job) => <Surface key={packageJobKey(job)} tone="card" padding="none" className="space-y-3 rounded-lg p-4">
            <div className="flex items-center gap-3"><AppArtworkIcon appId={job.appId} displayName={jobName(job)} size="sm" /><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{jobName(job)}</h3><p className="text-xs text-[var(--nimi-text-secondary)]">{job.targetVersion}</p></div><StatusBadge tone="info">{t('Apps.downloads.phase.downloading')}</StatusBadge></div>
            {metrics(job)}<p className="text-xs leading-5 text-[var(--nimi-text-secondary)]">{t('Apps.downloads.afterDownload')}</p>
            <div className="flex flex-wrap justify-between gap-2">{actions(job)}<Button tone="ghost" size="sm" ref={(node) => { if (node) rowRefs.current.set(packageJobKey(job), node); }} onClick={() => select(job)}>{t('Apps.downloads.details')}</Button></div>
          </Surface>)}</section> : null}
          {group('processing', processing)}{group('attention', failed)}{group('upNext', queued, true)}{group('paused', paused)}
          {!active.length && !processing.length && !queued.length && !paused.length && !failed.length && downloads.status === 'ready' ? <EmptyState icon={<Check className="h-6 w-6" aria-hidden="true" />} title={t('Apps.downloads.empty')} description={t('Apps.downloads.emptyHint')} /> : null}
          {recent.length ? <section><Button tone="ghost" size="sm" aria-expanded={recentOpen} onClick={() => setRecentOpen(!recentOpen)}>{t('Apps.downloads.recent', { count: recent.length })}</Button>
            {recentOpen ? (
              <Surface tone="card" padding="none" className="mt-2 overflow-hidden rounded-lg">
                <ul>
                  {recent.map((job) => row(job))}
                </ul>
              </Surface>
            ) : null}
          </section> : null}
        </div>
        {detail ? <Surface as="aside" tone="card" padding="none" className={`min-w-0 self-start rounded-lg p-4 ${selected ? '' : 'hidden xl:block'}`} data-testid="apps-download-detail">
          <Button tone="ghost" size="sm" className="mb-3 xl:hidden" leadingIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />} onClick={back}>{t('Apps.downloads.back')}</Button>
          <h2 tabIndex={-1} ref={headingRef} className="break-words text-base font-semibold outline-none">{jobName(detail)}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(detail.kind === AppPackageJobKind.UPDATE ? 'Apps.downloads.updateVersion' : 'Apps.downloads.installVersion', { from: detail.previousVersion, version: detail.targetVersion })}</p>
          <div className="my-3"><StatusBadge tone={jobTone(detail)}>{t(`Apps.downloads.phase.${appDownloadPhase(detail)}`)}</StatusBadge></div>
          {detail.sourceClass === AppPackageSourceClass.VERIFIED && [AppPackageJobPhase.DOWNLOADING, AppPackageJobPhase.QUEUED, AppPackageJobPhase.PAUSED].includes(detail.phase) ? <div className="mb-3">{metrics(detail)}</div> : null}
          {actions(detail)}
          <div className="mt-4 space-y-2 text-xs leading-5 text-[var(--nimi-text-secondary)]">
            {detail.sourceClass === AppPackageSourceClass.VERIFIED && detail.phase === AppPackageJobPhase.QUEUED ? <p>{t('Apps.downloads.position', { position: detail.queuePosition || '—' })}</p> : null}
            {detail.phase === AppPackageJobPhase.PAUSED ? <p>{t(['runtime-interrupted', 'download-interrupted'].includes(detail.reasonCode) ? 'Apps.downloads.interruptedHint' : 'Apps.downloads.pausedHint')}</p> : null}
            {detail.phase === AppPackageJobPhase.VERIFYING ? <p>{t(detail.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'Apps.localImport.verifyingHint' : 'Apps.downloads.verifyingHint')}</p> : null}
            {detail.phase === AppPackageJobPhase.STAGING ? <p>{t('Apps.downloads.stagingHint')}</p> : null}
            {detail.phase === AppPackageJobPhase.COMMITTING ? <p>{t('Apps.downloads.committingHint')}</p> : null}
            {detail.phase === AppPackageJobPhase.FAILED ? <p>{t(detail.reasonCode === 'verification-failed' ? 'Apps.downloads.verificationFailed'
              : detail.reasonCode === 'stale-selection' ? 'Apps.downloads.staleSelection' : detail.reasonCode === 'policy-blocked' ? 'Apps.downloads.policyBlocked' : 'Apps.downloads.failedHint')}</p> : null}
            {detail.phase === AppPackageJobPhase.COMPLETED ? <p>{t('Apps.downloads.completedHint', { version: detail.targetVersion })}</p> : null}
            {detail.phase === AppPackageJobPhase.CANCELED ? <p>{t(detail.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'Apps.localImport.canceledHint' : 'Apps.downloads.canceledHint')}</p> : null}
            {detail.kind === AppPackageJobKind.UPDATE && !packageJobIsTerminal(detail) ? <p>{t(detail.cancelable ? 'Apps.downloads.updateUnavailable' : 'Apps.downloads.updateCommitting', { version: detail.previousVersion })}</p> : null}
          </div>
          <details className="mt-4 border-t border-[var(--nimi-border-subtle)] pt-3">
            <summary className="cursor-pointer text-xs font-semibold">{t('Apps.downloads.packageInfo')}</summary>
            <dl className="mt-3 space-y-2 break-words text-xs leading-5 text-[var(--nimi-text-secondary)]">
              <div><dt>{t('Apps.downloads.target')}</dt><dd>{detail.targetOs} · {detail.targetArch} · {detail.targetVersion}</dd></div>
              <div><dt>{t('Apps.catalog.asset')}</dt><dd>{detail.bytesTotal ? formatBytes(Number(detail.bytesTotal)) : t('Apps.downloads.bytesUnknown')}</dd></div>
              {catalog ? <><div><dt>{t('Apps.catalog.publisher')}</dt><dd>@{catalog.publisherGithubNamespace}</dd></div>
                <div><dt>{t('Apps.downloads.source')}</dt><dd className="break-all"><a href={catalog.sourceRepository} className="underline underline-offset-2" onClick={(event) => {
                  event.preventDefault(); setSourceError('');
                  void openExternalUrl(catalog.sourceRepository).catch((error: unknown) => setSourceError(error instanceof Error ? error.message : String(error)));
                }}>{catalog.sourceRepository}</a></dd></div>
                <div><dt>{t('Apps.downloads.nativePosture')}</dt><dd>{catalog.os === 'macos' ? catalog.macosNotarization : catalog.windowsCodeSigning}{catalog.observedSigningSubject ? ` · ${catalog.observedSigningSubject}` : ''}</dd></div></> : null}
              {detail.sourceClass === AppPackageSourceClass.USER_IMPORTED ? <div><dt>{t('Apps.downloads.source')}</dt><dd>{t('Apps.localImport.localSource')}</dd></div> : null}
              <div><dt>App ID</dt><dd>{detail.appId}</dd></div><div><dt>{t('Apps.downloads.jobId')}</dt><dd className="break-all">{packageJobKey(detail)}</dd></div>
              {detail.reasonCode ? <div><dt>{t('Apps.downloads.reason')}</dt><dd className="break-all">{detail.reasonCode}</dd></div> : null}
            </dl>
          </details>
        </Surface> : null}
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t('Apps.downloads.ownerHint')}</p>
    </ScrollArea>
    <ConfirmDialog open={cancelJob !== null} title={t(cancelJob?.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'Apps.localImport.cancelTitle' : 'Apps.downloads.cancelTitle')} confirmTone="danger"
      message={cancelJob ? t(cancelJob.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'Apps.localImport.cancelMessage' : 'Apps.downloads.cancelMessage', { app: jobName(cancelJob), size: formatBytes(Number(cancelJob.bytesCompleted)) }) : ''}
      confirmLabel={t(cancelJob?.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'Apps.localImport.confirmCancel' : 'Apps.downloads.confirmCancel')} cancelLabel={t('Apps.downloads.keepTask')} loading={busy}
      onClose={() => setCancelJob(null)} onConfirm={() => {
        if (!cancelJob) return;
        void execute('cancel', [cancelJob]).then(() => {
          setCancelJob(null);
        });
      }} />
  </div>;
}
