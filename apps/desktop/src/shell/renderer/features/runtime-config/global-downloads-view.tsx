import {
  Button,
  IconButton,
  InlineAlert,
  LoadingSkeleton,
  NimiTabs,
  ScrollArea,
  Surface,
  Tooltip,
} from '@nimiplatform/kit/ui';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
} from '@nimiplatform/sdk/runtime';
import { AppPackageJobPhase, AppPackageSourceClass } from '@nimiplatform/sdk/runtime/wire-types';
import { Download } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { appPackageFailureReason } from '../apps/apps-card-fields.js';
import { useAppsDownloads } from '../apps/apps-downloads-context.js';
import { packageJobKey } from '../apps/apps-downloads-observer.js';
import { appDownloadPhase } from '../apps/apps-downloads-view.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { useGlobalDownloads } from './global-downloads-context.js';
import {
  appJobLane,
  downloadModelName,
  DownloadTaskRow,
  environmentLane,
  environmentStage,
  groupTransferAttempts,
  interruptionReasonKey,
  setupTaskLane,
  transferLane,
  transferStage,
  type DownloadStage,
  type DownloadsLane,
} from './global-downloads-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { isDownloadTerminal } from './runtime-config-model-center-utils.js';
import { getRuntimeSetupTaskStore, useRuntimeSetupTasks } from './runtime-setup-task-store.js';
import { useRuntimeModelLibrary } from './use-runtime-model-library.js';

const AppDownloadsDetail = lazy(async () => ({ default: (await import('../apps/apps-panel.js')).AppsPanel }));

function appJobStage(phase: string): DownloadStage {
  switch (phase) {
    case 'queued': return 'queued';
    case 'downloading': return 'downloading';
    case 'paused': return 'paused';
    case 'verifying': return 'verifying';
    case 'completed': return 'done';
    case 'failed': return 'interrupted';
    case 'canceled': return 'cancelled';
    default: return 'installing';
  }
}

/**
 * The rail entry: a download arrow that becomes a progress ring while work is
 * running. The ring only draws when every active transfer reports a total;
 * otherwise it spins as an indeterminate arc.
 */
export function GlobalDownloadsNavigation({ onOpen }: { readonly onOpen: () => void }) {
  const { t } = useTranslation();
  const downloads = useGlobalDownloads();
  const apps = useAppsDownloads();
  const activeTransfers = downloads?.transfers.filter((item) => !isDownloadTerminal(item.state)) ?? [];
  const activeAppJobs = apps?.jobs.filter((job) => appJobLane(job.phase) === 'active') ?? [];
  const known = activeTransfers.length + activeAppJobs.length > 0
    && !downloads?.environments.some((job) => isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state))
    && activeTransfers.every((item) => typeof item.bytesTotal === 'number' && item.bytesTotal > 0)
    && activeAppJobs.every((job) => Number(job.bytesTotal) > 0);
  const received = activeTransfers.reduce((total, item) => total + item.bytesReceived, 0)
    + activeAppJobs.reduce((total, job) => total + Number(job.bytesCompleted), 0);
  const total = activeTransfers.reduce((sum, item) => sum + (item.bytesTotal ?? 0), 0)
    + activeAppJobs.reduce((sum, job) => sum + Number(job.bytesTotal ?? 0), 0);
  const fraction = known && total > 0 ? Math.min(1, received / total) : null;
  const active = (downloads?.activeCount ?? 0) > 0;
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  return (
    <Tooltip
      content={active && fraction !== null ? `${t('runtimeConfig.downloads.title')} · ${Math.round(fraction * 100)}%` : t('runtimeConfig.downloads.title')}
      placement="right"
    >
      <div className="relative">
        {active ? (
          <svg
            className={`pointer-events-none absolute inset-0 m-auto size-11 -rotate-90 ${fraction === null ? 'animate-spin' : ''}`}
            viewBox="0 0 44 44"
            aria-hidden="true"
            data-testid="global-downloads-ring"
          >
            <circle cx="22" cy="22" r={radius} fill="none" stroke="var(--nimi-border-subtle)" strokeWidth="2" />
            <circle
              cx="22"
              cy="22"
              r={radius}
              fill="none"
              stroke="var(--nimi-action-primary-bg)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={fraction === null ? circumference * 0.75 : circumference * (1 - fraction)}
              className="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
        ) : null}
        <IconButton
          size="sm"
          data-testid="global-downloads-entry"
          aria-label={t('runtimeConfig.downloads.title')}
          icon={<Download size={19} />}
          onClick={onOpen}
          className={active ? 'text-[var(--nimi-action-primary-bg)]' : ''}
        />
        {downloads?.activeCount && downloads.activeCount > 1 ? (
          <span className="pointer-events-none absolute -right-1 -top-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-1 text-[10px] leading-4 text-[var(--nimi-action-primary-text)]">
            {downloads.activeCount}
          </span>
        ) : null}
      </div>
    </Tooltip>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.global-downloads
export function GlobalDownloadsView() {
  const { t } = useTranslation();
  const downloads = useGlobalDownloads();
  const apps = useAppsDownloads();
  const local = useRuntimeConfigLocalEnvironmentClient();
  const library = useRuntimeModelLibrary();
  const appInventory = useAppsOverview();
  const appEntries = new Map(
    appInventory.data?.status === 'loaded'
      ? appInventory.data.entries.map((entry) => [entry.identity.appId, entry])
      : [],
  );
  const commands = useDesktopRendererCommands();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const store = getRuntimeSetupTaskStore();
  const snapshot = useRuntimeSetupTasks(store);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lane, setLane] = useState<DownloadsLane>('active');
  const [appDetails, setAppDetails] = useState(false);
  useEffect(() => {
    if (apps?.view !== 'downloads') return;
    if (apps.selectedJobId) setAppDetails(true);
    apps.showLibrary();
  }, [apps?.view, apps?.selectedJobId, apps?.showLibrary]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await downloads?.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const transfers = downloads?.transfers.filter((item) => transferLane(item.state) === lane) ?? [];
  const environments = downloads?.environments.filter((item) => environmentLane(item) === lane) ?? [];
  const appJobs = apps?.jobs.filter((item) => appJobLane(item.phase) === lane) ?? [];
  const grouped = new Map<string, typeof snapshot.tasks>();
  for (const task of snapshot.tasks) {
    if (setupTaskLane(task) !== lane) continue;
    if (
      ['draft', 'review'].includes(task.status) &&
      !task.authorization &&
      !task.refs.installPlanIds.length &&
      !task.refs.dependencyJobIds.length
    )
      continue;
    const key = task.draft?.profileUseId ?? task.taskId;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }
  const lanes: DownloadsLane[] = ['active', 'attention', 'history'];
  const counts = Object.fromEntries(
    lanes.map((value) => [
      value,
      (value === 'active'
        ? downloads?.transfers.filter((item) => transferLane(item.state) === value).length ?? 0
        : groupTransferAttempts(downloads?.transfers.filter((item) => transferLane(item.state) === value) ?? []).length) +
        (downloads?.environments.filter((item) => environmentLane(item) === value).length ?? 0) +
        (apps?.jobs.filter((item) => appJobLane(item.phase) === value).length ?? 0),
    ]),
  );
  const usedTransfers = new Set<string>();
  const usedEnvironments = new Set<string>();
  const transferRow = (item: (typeof transfers)[number], attempts = 1) => {
    const stage = transferStage(item);
    return (
      <DownloadTaskRow
        key={item.installSessionId}
        testId={`download-model:${item.installSessionId}`}
        title={downloadModelName(item.modelId, library.data?.catalog ?? []) ?? item.modelId}
        kind="model"
        lane={transferLane(item.state)}
        stage={stage}
        bytes={item.bytesReceived}
        total={item.bytesTotal}
        speedBytesPerSec={item.speedBytesPerSec}
        etaSeconds={item.etaSeconds}
        at={item.updatedAt}
        attempts={attempts}
        reason={stage === 'interrupted' ? t(interruptionReasonKey(`${item.message ?? ''} ${item.reasonCode ?? ''}`)) : undefined}
        technical={[item.modelId, item.message, item.reasonCode].filter(Boolean).join(' · ')}
      >
        <div className="flex gap-2">
          {item.sessionKind === 'download' && ['running', 'queued'].includes(item.state) ? (
            <Button
              size="sm"
              tone="secondary"
              disabled={busy}
              onClick={() => {
                void action(() => local.pauseTransfer(item.installSessionId, { caller: 'core' }));
              }}
            >
              {t('Apps.downloads.pause')}
            </Button>
          ) : null}
          {item.sessionKind === 'download' &&
          (item.state === 'paused' || (['failed', 'cancelled'].includes(item.state) && item.retryable)) ? (
            <Button
              size="sm"
              tone={item.state === 'paused' ? 'primary' : 'secondary'}
              disabled={busy}
              onClick={() => {
                void action(() => local.resumeTransfer(item.installSessionId, { caller: 'core' }));
              }}
            >
              {t(item.state === 'paused' ? 'Apps.downloads.resume' : 'runtimeConfig.downloads.retryDownload')}
            </Button>
          ) : null}
          {!isDownloadTerminal(item.state) ? (
            <Button
              size="sm"
              tone="ghost"
              disabled={busy}
              onClick={() => {
                void action(() => local.cancelTransfer(item.installSessionId, { caller: 'core' }));
              }}
            >
              {t('Common.cancel')}
            </Button>
          ) : null}
        </div>
      </DownloadTaskRow>
    );
  };
  const transferGroup = (group: ReturnType<typeof groupTransferAttempts>[number]) => (
    group.attempts.length > 1 ? (
      <div key={`group:${group.latest.modelId}`}>
        {transferRow(group.latest, group.attempts.length)}
        <details className="-mt-2 mb-2 pl-14 text-xs text-[var(--nimi-text-secondary)]">
          <summary className="cursor-pointer">{t('runtimeConfig.downloads.showAttempts', { count: group.attempts.length - 1 })}</summary>
          <ul className="mt-1 space-y-1">
            {group.attempts.slice(1).map((attempt) => (
              <li key={attempt.installSessionId} className="flex flex-wrap justify-between gap-2 tabular-nums">
                <span>{new Date(attempt.updatedAt).toLocaleString()}</span>
                <span>{t(`runtimeConfig.downloads.stage.${transferStage(attempt)}`)} · {attempt.bytesReceived > 0 ? `${Math.round((attempt.bytesReceived / Math.max(1, attempt.bytesTotal ?? attempt.bytesReceived)) * 100)}%` : '0%'}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    ) : (
      transferRow(group.latest)
    )
  );
  const environmentRow = (item: (typeof environments)[number]) => {
    const stage = environmentStage(item);
    return (
      <DownloadTaskRow
        key={item.jobId}
        testId={`download-environment:${item.jobId}`}
        title={item.dependencyFamily}
        kind="environment"
        lane={environmentLane(item)}
        stage={stage}
        bytes={item.bytesReceived}
        total={item.bytesTotal}
        at={item.updatedAt}
        reason={stage === 'interrupted' ? t(interruptionReasonKey(`${item.failureDetail ?? ''} ${item.reasonCode ?? ''}`)) : undefined}
        technical={[item.dependencyId, item.failureDetail, item.reasonCode].filter(Boolean).join(' · ')}
      >
        <div className="flex gap-2">
          {isNimiRuntimeLocalEnvironmentDependencyJobActiveState(item.state) ? (
            <Button
              size="sm"
              tone="ghost"
              disabled={busy}
              onClick={() => {
                void action(() =>
                  local.cancelEnvironmentDependencyJob({ jobId: item.jobId }, { caller: 'core' }),
                );
              }}
            >
              {t('Common.cancel')}
            </Button>
          ) : null}
          {item.retryable && !isNimiRuntimeLocalEnvironmentDependencyReadyState(item.state) ? (
            <Button
              size="sm"
              tone="secondary"
              disabled={busy}
              onClick={() => {
                void action(() =>
                  local.retryEnvironmentDependencyJob(
                    { jobId: item.jobId, confirmed: true },
                    { caller: 'core' },
                  ),
                );
              }}
            >
              {t('Common.retry')}
            </Button>
          ) : null}
        </div>
      </DownloadTaskRow>
    );
  };
  const loading = downloads?.loading || apps?.status === 'loading';
  const empty = !loading &&
    !downloads?.errors.length &&
    !apps?.error &&
    !grouped.size &&
    !transfers.length &&
    !environments.length &&
    !appJobs.length;
  const statusLine = loading
    ? t('Common.loading')
    : counts.active
      ? t('runtimeConfig.downloads.summaryActive', { count: counts.active })
      : counts.attention
        ? t('runtimeConfig.downloads.summaryAttention', { count: counts.attention })
        : t('runtimeConfig.downloads.summaryIdle');
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <Surface tone="panel" padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4 pt-6 lg:px-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('runtimeConfig.downloads.title')}</h1>
            <p className="mt-1.5 text-sm text-[var(--nimi-text-secondary)]">{statusLine}</p>
          </div>
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              void downloads?.refresh();
            }}
          >
            {t('Common.refresh')}
          </Button>
        </header>
        {!appDetails ? (
          <div className="border-b border-[var(--nimi-border-subtle)] px-6 lg:px-8">
            <NimiTabs
              ariaLabel={t('runtimeConfig.downloads.title')}
              value={lane}
              onValueChange={(value) => setLane(value as DownloadsLane)}
              items={lanes.map((value) => ({
                value,
                label:
                  t(`runtimeConfig.product.downloadLane.${value}`) +
                  (counts[value] ? ' (' + counts[value] + ')' : ''),
              }))}
            />
          </div>
        ) : null}
        {appDetails ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <Button tone="ghost" onClick={() => setAppDetails(false)}>
              {t('runtimeConfig.downloads.back')}
            </Button>
            <Suspense fallback={<LoadingSkeleton className="h-32" />}>
              <AppDownloadsDetail downloadsOnly />
            </Suspense>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1" contentClassName="space-y-4 px-6 py-4 lg:px-8">
            {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
            {downloads?.errors.length || apps?.error ? (
              <InlineAlert tone="warning">
                {t('runtimeConfig.downloads.readFailed')}
                <details>
                  <summary>{t('runtimeConfig.profiles.technicalDetails')}</summary>
                  {[...(downloads?.errors ?? []), apps?.error].filter(Boolean).join(' · ')}
                </details>
              </InlineAlert>
            ) : null}
            {[...grouped.entries()].map(([id, tasks]) => {
              const taskTransfers = transfers.filter(
                (item) =>
                  !usedTransfers.has(item.installSessionId) &&
                  tasks.some(
                    (task) =>
                      task.refs.transferIds.includes(item.installSessionId) ||
                      (!!item.planId && task.refs.installPlanIds.includes(item.planId)),
                  ),
              );
              taskTransfers.forEach((item) => usedTransfers.add(item.installSessionId));
              const taskEnvironments = environments.filter(
                (item) =>
                  !usedEnvironments.has(item.jobId) &&
                  tasks.some((task) => task.refs.dependencyJobIds.includes(item.jobId)),
              );
              taskEnvironments.forEach((item) => usedEnvironments.add(item.jobId));
              return (
                <section key={id} className="rounded-2xl bg-[var(--nimi-surface-card)] px-5 pb-1 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--nimi-text-muted)]">
                        {t('runtimeConfig.downloads.setupGroup')}
                      </p>
                      <h2 className="font-semibold">
                        {tasks[0]?.draft?.profileTitle ??
                          displayRuntimeConfigCapabilityLabel(tasks[0]!.capabilityContract, t)}
                      </h2>
                      <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">
                        {tasks
                          .map((task) => `${displayRuntimeConfigCapabilityLabel(task.capabilityContract, t)} · ${t(`runtimeConfig.setupTask.status.${task.status}`)}`)
                          .join(' · ')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      tone="secondary"
                      onClick={() => {
                        commands.runtimeConfigNavigation.openSetupTask(tasks[0]!.taskId);
                        setActiveTab('runtime');
                      }}
                    >
                      {t('runtimeConfig.downloads.openSetup')}
                    </Button>
                  </div>
                  {taskTransfers.map((item) => transferRow(item))}
                  {taskEnvironments.map(environmentRow)}
                </section>
              );
            })}
            {lane === 'active'
              ? transfers.filter((item) => !usedTransfers.has(item.installSessionId)).map((item) => transferRow(item))
              : groupTransferAttempts(transfers.filter((item) => !usedTransfers.has(item.installSessionId))).map(transferGroup)}
            {environments.filter((item) => !usedEnvironments.has(item.jobId)).map(environmentRow)}
            {(lane === 'active'
              ? appJobs.map((job) => ({ job, attempts: 1 }))
              : [...new Map(
                  [...appJobs]
                    .sort((left, right) => Number(right.updatedAt?.seconds ?? 0) - Number(left.updatedAt?.seconds ?? 0))
                    .reverse()
                    .map((job) => [job.appId, job] as const),
                ).values()].map((job) => ({ job, attempts: appJobs.filter((item) => item.appId === job.appId).length }))
            ).map(({ job, attempts }) => {
              const entry = appEntries.get(job.appId);
              const stage = appJobStage(appDownloadPhase(job));
              const failure = appPackageFailureReason(job);
              const displayName = job.displayName || entry?.identity.displayName || job.appId;
              return (
                <DownloadTaskRow
                  key={packageJobKey(job)}
                  testId={`download-app:${packageJobKey(job)}`}
                  title={displayName}
                  kind="app"
                  lane={appJobLane(job.phase)}
                  stage={stage}
                  bytes={Number(job.bytesCompleted)}
                  total={Number(job.bytesTotal)}
                  attempts={attempts}
                  at={job.updatedAt ? new Date(Number(job.updatedAt.seconds) * 1000).toISOString() : undefined}
                  reason={stage === 'interrupted' ? t(interruptionReasonKey(failure ?? '')) : undefined}
                  technical={failure ?? undefined}
                  leading={<AppArtworkIcon appId={job.appId} displayName={displayName} iconUrl={entry?.iconUrl ?? null} size="md" className="mt-0.5" />}
                >
                  <div className="flex flex-wrap gap-2">
                    {job.sourceClass === AppPackageSourceClass.VERIFIED &&
                    [AppPackageJobPhase.QUEUED, AppPackageJobPhase.DOWNLOADING].includes(job.phase) ? (
                      <Button
                        size="sm"
                        tone="secondary"
                        disabled={busy}
                        onClick={() => {
                          void action(async () => {
                            const results = await apps!.observer.control('pause', [job]);
                            if (results[0]?.error) throw Error(results[0].error);
                          });
                        }}
                      >
                        {t('Apps.downloads.pause')}
                      </Button>
                    ) : null}
                    {job.phase === AppPackageJobPhase.PAUSED ? (
                      <Button
                        size="sm"
                        tone="primary"
                        disabled={busy}
                        onClick={() => {
                          void action(async () => {
                            const results = await apps!.observer.control('resume', [job]);
                            if (results[0]?.error) throw Error(results[0].error);
                          });
                        }}
                      >
                        {t('Apps.downloads.resume')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      tone="ghost"
                      onClick={() => {
                        apps?.selectJob(packageJobKey(job));
                        setAppDetails(true);
                      }}
                    >
                      {t('runtimeConfig.downloads.appDetails')}
                    </Button>
                  </div>
                </DownloadTaskRow>
              );
            })}
            {loading ? <LoadingSkeleton lines={4} label={t('Common.loading')} /> : null}
            {empty ? (
              <div className="flex flex-col items-center py-16 text-center">
                <Download size={32} strokeWidth={1.4} className="mb-4 text-[var(--nimi-text-muted)]" />
                <h2 className="text-lg font-semibold">{t(`runtimeConfig.product.downloadEmpty.${lane}`)}</h2>
                <p className="mt-2 max-w-md text-sm text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.product.downloadEmptyHelp')}
                </p>
                {lane === 'active' && counts.attention ? (
                  <Button className="mt-5" tone="secondary" onClick={() => setLane('attention')}>
                    {t('runtimeConfig.product.viewInterrupted', { count: counts.attention })}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </ScrollArea>
        )}
      </Surface>
    </div>
  );
}
