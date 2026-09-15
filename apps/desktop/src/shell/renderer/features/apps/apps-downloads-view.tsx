import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, ChevronsUp, Download, GripVertical, Pause, Play } from 'lucide-react';
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
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const draggedJobId = useRef<string | null>(null);
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
  const selectedIsRecent = recent.some((job) => packageJobKey(job) === downloads.selectedJobId);
  const showRecent = recentOpen || selectedIsRecent;
  const busy = downloads.pendingIds.length > 0;
  const unavailable = downloads.status !== 'ready';
  const blocked = busy || unavailable;

  useEffect(() => {
    if (!downloads.selectedJobId) return;
    const control = rowRefs.current.get(downloads.selectedJobId);
    control?.closest('li')?.scrollIntoView({ block: 'nearest' });
    control?.focus({ preventScroll: true });
  }, [downloads.selectedJobId, selected?.phase]);

  useEffect(() => {
    const changed = jobs.filter((job) => previousPhases.current.get(packageJobKey(job)) !== job.phase);
    if (previousPhases.current.size && changed.length) setPhaseFeedback(changed.map((job) => `${jobName(job)}: ${t(`Apps.downloads.phase.${appDownloadPhase(job)}`)}`).join('. '));
    previousPhases.current = new Map(jobs.map((job) => [packageJobKey(job), job.phase]));
  }, [jobs, t]);

  const restoreFocus = (jobId: string | null) => requestAnimationFrame(() => {
    const candidates = [jobId ? rowRefs.current.get(jobId) : null, pageHeadingRef.current];
    for (const candidate of candidates) {
      if (candidate?.isConnected && candidate.getClientRects().length) { candidate.focus(); return; }
    }
  });

  const select = (job: AppPackageJob) => {
    ++focusRevision.current;
    if (selectedIsRecent) setRecentOpen(true);
    const id = packageJobKey(job);
    downloads.selectJob(downloads.selectedJobId === id ? null : id);
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
  const phaseHint = (job: AppPackageJob): string | null => {
    switch (job.phase) {
      case AppPackageJobPhase.DOWNLOADING: return t('Apps.downloads.afterDownload');
      case AppPackageJobPhase.PAUSED: return t(['runtime-interrupted', 'download-interrupted'].includes(job.reasonCode) ? 'Apps.downloads.interruptedHint' : 'Apps.downloads.pausedHint');
      case AppPackageJobPhase.VERIFYING: return t(job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'Apps.localImport.verifyingHint' : 'Apps.downloads.verifyingHint');
      case AppPackageJobPhase.STAGING: return t('Apps.downloads.stagingHint');
      case AppPackageJobPhase.COMMITTING: return t('Apps.downloads.committingHint');
      case AppPackageJobPhase.FAILED: return t(job.reasonCode === 'verification-failed' ? 'Apps.downloads.verificationFailed'
        : job.reasonCode === 'stale-selection' ? 'Apps.downloads.staleSelection' : job.reasonCode === 'policy-blocked' ? 'Apps.downloads.policyBlocked' : 'Apps.downloads.failedHint');
      case AppPackageJobPhase.COMPLETED: return t('Apps.downloads.completedHint', { version: job.targetVersion });
      case AppPackageJobPhase.CANCELED: return t(job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'Apps.localImport.canceledHint' : 'Apps.downloads.canceledHint');
      default: return null;
    }
  };
  const row = (job: AppPackageJob, order = false) => {
    const id = packageJobKey(job);
    const expanded = downloads.selectedJobId === id;
    const position = queued.findIndex((candidate) => packageJobKey(candidate) === id);
    const matchingEntry = entries.find((entry) => entry.identity.appId === job.appId && entry.identity.sourceClass === (job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'user_imported' : 'verified'));
    const catalog = catalogTargetMatchesJob(matchingEntry?.catalogTarget ?? null, job) ? matchingEntry?.catalogTarget : null;
    const hint = phaseHint(job);
    const showHint = hint && (!packageJobIsTerminal(job) || failedDownloadNeedsAttention(job, jobs) || expanded);
    return <li key={id} data-testid={`app-download-job-${id}`} className="min-w-0 space-y-3 border-b border-[var(--nimi-border-subtle)] p-4 last:border-b-0"
      draggable={order && !blocked} onDragStart={() => { draggedJobId.current = id; }} onDragEnd={() => { draggedJobId.current = null; }}
      onDragOver={(event) => { if (order && !blocked) event.preventDefault(); }} onDrop={(event) => {
        event.preventDefault();
        const dragged = queued.find((candidate) => packageJobKey(candidate) === draggedJobId.current);
        draggedJobId.current = null;
        if (!blocked && order && dragged && packageJobKey(dragged) !== id) void execute('reorder', [dragged], job.jobId);
      }}>
      <div className="flex items-center gap-3">
        {order ? <span className="flex items-center gap-1 text-xs tabular-nums text-[var(--nimi-text-muted)]" aria-label={t('Apps.downloads.position', { position: job.queuePosition || '—' })}><GripVertical className="h-4 w-4" aria-hidden="true" />{job.queuePosition || '—'}</span> : null}
        <AppArtworkIcon appId={job.appId} displayName={jobName(job)} iconUrl={matchingEntry?.iconUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 id={`app-download-heading-${id}`} className="break-words text-sm font-semibold text-[var(--nimi-text-primary)]">{jobName(job)}</h3>
          {job.targetVersion || job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? <p className="mt-1 break-words text-xs text-[var(--nimi-text-secondary)]">
            {job.targetVersion ? t(job.kind === AppPackageJobKind.UPDATE
              ? job.previousVersion ? 'Apps.downloads.updateVersion' : 'Apps.update.toVersion'
              : 'Apps.downloads.installVersion', { from: job.previousVersion, version: job.targetVersion }) : null}
            {job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? `${job.targetVersion ? ' · ' : ''}${t('Apps.localImport.localSource')}` : ''}
          </p> : null}
        </div>
        <StatusBadge tone={jobTone(job)} className="shrink-0">{t(`Apps.downloads.phase.${appDownloadPhase(job)}`)}</StatusBadge>
      </div>
      {job.sourceClass === AppPackageSourceClass.VERIFIED && ([AppPackageJobPhase.DOWNLOADING, AppPackageJobPhase.PAUSED].includes(job.phase)
        || (job.phase === AppPackageJobPhase.QUEUED && Number(job.bytesCompleted) > 0)) ? metrics(job) : null}
      {showHint ? <p className="text-xs leading-5 text-[var(--nimi-text-secondary)]">{hint}</p> : null}
      {job.kind === AppPackageJobKind.UPDATE && !packageJobIsTerminal(job) ? <p className="text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(job.cancelable ? 'Apps.downloads.updateUnavailable' : 'Apps.downloads.updateCommitting', { version: job.previousVersion })}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {actions(job)}
          {order ? <div className="flex items-center gap-1">
            <IconButton size="sm" disabled={blocked || position <= 0} icon={<ChevronsUp className="h-4 w-4" aria-hidden="true" />} aria-label={t('Apps.downloads.nextNamed', { app: jobName(job) })}
              onClick={() => void execute('reorder', [job], queued[0]?.jobId)} />
            <IconButton size="sm" disabled={blocked || position <= 0} icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />} aria-label={t('Apps.downloads.upNamed', { app: jobName(job) })}
              onClick={() => void execute('reorder', [job], queued[position - 1]?.jobId)} />
            <IconButton size="sm" disabled={blocked || position === queued.length - 1} icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />} aria-label={t('Apps.downloads.downNamed', { app: jobName(job) })}
              onClick={() => void execute('reorder', [job], queued[position + 2]?.jobId ?? new Uint8Array())} />
          </div> : null}
        </div>
        <Button tone="ghost" size="sm" aria-expanded={expanded} aria-controls={`app-download-details-${id}`}
          aria-label={t(expanded ? 'Apps.downloads.hideDetailsNamed' : 'Apps.downloads.detailsNamed', { app: jobName(job) })}
          trailingIcon={expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          ref={(node) => { if (node) rowRefs.current.set(id, node); else rowRefs.current.delete(id); }} onClick={() => select(job)}>
          {t(expanded ? 'Apps.downloads.hideDetails' : 'Apps.downloads.packageInfo')}
        </Button>
      </div>
      <div id={`app-download-details-${id}`} hidden={!expanded} role="region" aria-labelledby={`app-download-heading-${id}`}
        data-testid={expanded ? 'apps-download-detail' : undefined} className="border-t border-[var(--nimi-border-subtle)] pt-3">
        {expanded ? <dl className="grid gap-x-6 gap-y-3 break-words text-xs leading-5 text-[var(--nimi-text-secondary)] sm:grid-cols-2">
          <div><dt className="font-medium text-[var(--nimi-text-primary)]">{t('Apps.downloads.target')}</dt><dd>{job.targetOs} · {job.targetArch} · {job.targetVersion}</dd></div>
          <div><dt className="font-medium text-[var(--nimi-text-primary)]">{t('Apps.catalog.asset')}</dt><dd>{job.bytesTotal ? formatBytes(Number(job.bytesTotal)) : t('Apps.downloads.bytesUnknown')}</dd></div>
          {catalog ? <><div><dt className="font-medium text-[var(--nimi-text-primary)]">{t('Apps.catalog.publisher')}</dt><dd>@{catalog.publisherGithubNamespace}</dd></div>
            <div><dt className="font-medium text-[var(--nimi-text-primary)]">{t('Apps.downloads.source')}</dt><dd className="break-all"><a href={catalog.sourceRepository} className="underline underline-offset-2" onClick={(event) => {
              event.preventDefault(); setSourceError('');
              void openExternalUrl(catalog.sourceRepository).catch((error: unknown) => setSourceError(error instanceof Error ? error.message : String(error)));
            }}>{catalog.sourceRepository}</a></dd></div>
            <div className="sm:col-span-2"><dt className="font-medium text-[var(--nimi-text-primary)]">{t('Apps.downloads.nativePosture')}</dt><dd>{catalog.os === 'macos' ? catalog.macosNotarization : catalog.windowsCodeSigning}{catalog.observedSigningSubject ? ` · ${catalog.observedSigningSubject}` : ''}</dd></div></> : null}
          {job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? <div><dt className="font-medium text-[var(--nimi-text-primary)]">{t('Apps.downloads.source')}</dt><dd>{t('Apps.localImport.localSource')}</dd></div> : null}
          <div><dt className="font-medium text-[var(--nimi-text-primary)]">App ID</dt><dd className="break-all">{job.appId}</dd></div>
          <div><dt className="font-medium text-[var(--nimi-text-primary)]">{t('Apps.downloads.jobId')}</dt><dd className="break-all">{id}</dd></div>
          {job.reasonCode ? <div className="sm:col-span-2"><dt className="font-medium text-[var(--nimi-text-primary)]">{t('Apps.downloads.reason')}</dt><dd className="break-all">{job.reasonCode}</dd></div> : null}
        </dl> : null}
      </div>
    </li>;
  };
  const group = (label: string, groupJobs: readonly AppPackageJob[], order = false) => {
    if (groupJobs.length === 0) return null;
    return (
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t(`Apps.downloads.${label}`)}
          <span className="text-xs font-normal tabular-nums text-[var(--nimi-text-secondary)]">{groupJobs.length}</span>
        </h2>
        <Surface tone="card" padding="none" className="overflow-hidden rounded-lg">
          <ul>
            {groupJobs.map((job) => row(job, order))}
          </ul>
        </Surface>
      </section>
    );
  };

  return <div className="flex min-h-0 flex-1 flex-col" data-testid="apps-downloads-view">
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 py-4">
      <div><h1 ref={pageHeadingRef} tabIndex={-1} className="text-xl font-semibold text-[var(--nimi-text-primary)] outline-none">{t('Apps.downloads.title')}</h1>
        <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t('Apps.downloads.summary', { downloading: active.length, processing: processing.length, queued: queued.length })}</p></div>
      {active.length + queued.length + paused.length > 1 ? <div className="flex flex-wrap gap-2">
        {active.length + queued.length > 0 ? <Button size="sm" disabled={blocked} onClick={() => void execute('pause', [...queued, ...active])}>{t('Apps.downloads.pauseAll')}</Button> : null}
        {paused.length > 0 ? <Button size="sm" disabled={blocked} onClick={() => void execute('resume', paused)}>{t('Apps.downloads.resumeAll')}</Button> : null}
      </div> : null}
    </header>
    <ScrollArea className="min-h-0 flex-1" contentClassName="px-4 pb-4">
      {downloads.status === 'unavailable' ? <InlineAlert tone="warning" className="mb-4" action={<Button size="sm" onClick={() => void downloads.observer.refresh()}>{t('Apps.downloads.refresh')}</Button>}>{t('Apps.downloads.disconnected')}</InlineAlert> : null}
      {actionErrors.length ? <InlineAlert tone="danger" className="mb-4"><p>{t('Apps.downloads.controlFailed')}</p><ul>{actionErrors.map((error, index) => <li className="break-words text-xs" key={index}>{error}</li>)}</ul></InlineAlert> : null}
      {sourceError ? <InlineAlert tone="warning" className="mb-4">{sourceError}</InlineAlert> : null}
      <div className="sr-only" role="status" aria-live="polite">{feedback} {phaseFeedback}</div>
      {downloads.status === 'loading' ? <p className="py-4 text-sm text-[var(--nimi-text-secondary)]">{t('Apps.downloads.loading')}</p> : null}
      <div className="min-w-0 space-y-4">
        {group('active', active)}
        {group('processing', processing)}{group('attention', failed)}{group('upNext', queued, true)}{group('paused', paused)}
        {!active.length && !processing.length && !queued.length && !paused.length && !failed.length && downloads.status === 'ready' ? (
          recent.length ? <p className="flex items-center gap-2 py-2 text-sm text-[var(--nimi-text-secondary)]"><Check className="h-4 w-4" aria-hidden="true" />{t('Apps.downloads.empty')}</p>
            : <EmptyState icon={<Check className="h-6 w-6" aria-hidden="true" />} title={t('Apps.downloads.empty')} description={t('Apps.downloads.emptyHint')} />
        ) : null}
        {recent.length ? <section><h2><Button tone="ghost" size="sm" aria-expanded={showRecent} aria-controls="app-download-recent"
          leadingIcon={showRecent ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          onClick={() => {
            ++focusRevision.current;
            if (showRecent && selectedIsRecent) downloads.selectJob(null);
            setRecentOpen(!showRecent);
          }}>{t('Apps.downloads.recent', { count: recent.length })}</Button></h2>
          <div id="app-download-recent" hidden={!showRecent}>
            {showRecent ? <Surface tone="card" padding="none" className="mt-2 overflow-hidden rounded-lg">
              <ul>
                {recent.map((job) => row(job))}
              </ul>
            </Surface> : null}
          </div>
        </section> : null}
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
