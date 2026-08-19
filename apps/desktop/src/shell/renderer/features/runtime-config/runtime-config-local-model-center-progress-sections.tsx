import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';

import type { NimiRuntimeLocalTransferProgressEvent } from '@nimiplatform/sdk/runtime';
import {
  FolderOpenIcon,
  DownloadIcon,
  assetTaskStatusLabel,
  isAssetTaskTerminal,
  localizedAssetKindLabel,
  type AssetTaskEntry,
} from './runtime-config-local-model-center-helpers';
import { ProgressIndicator } from '@nimiplatform/kit/ui';
import { Button } from './runtime-config-primitives';
import {
  downloadStateLabel,
  formatBytes,
  formatDownloadPhaseLabel,
  formatEta,
  formatImportPhaseLabel,
  formatSpeed,
} from './runtime-config-model-center-utils';

type TransferCardProps = {
  event: NimiRuntimeLocalTransferProgressEvent;
  t: TFunction;
  runtimeWritesDisabled: boolean;
  onPause: (installSessionId: string) => void;
  onResume: (installSessionId: string) => void;
  onCancel: (installSessionId: string) => void;
  onDismiss: (installSessionId: string) => void;
};

function LocalTransferDownloadCard(props: TransferCardProps) {
  const { event, t } = props;
  const isRunning = event.state === 'running';
  const isPaused = event.state === 'paused';
  const isFailed = event.state === 'failed';
  const isCancelled = event.state === 'cancelled';
  const canPause = event.state === 'queued' || isRunning;
  const canResume = isPaused || (isFailed && event.retryable);
  const canCancel = event.state !== 'completed' && event.state !== 'cancelled';
  const phaseLabel = formatDownloadPhaseLabel(event.phase, t);
  const pausedMetaLabel = t('runtimeConfig.localModelCenter.downloadState.paused', { defaultValue: 'Paused' });
  const progressMeta = event.phase === 'verify'
    ? (event.speedBytesPerSec && event.speedBytesPerSec > 0
        ? t('runtimeConfig.localModelCenter.verifyProgressWithEta', {
          speed: formatSpeed(event.speedBytesPerSec),
          eta: formatEta(event.etaSeconds),
          defaultValue: '{{speed}} verify · ETA {{eta}}',
        })
        : t('runtimeConfig.localModelCenter.verifyingLocalFile', { defaultValue: 'Verifying local file...' }))
    : event.phase === 'upsert'
      ? t('runtimeConfig.localModelCenter.finalizingInstallation', { defaultValue: 'Finalizing installation...' })
      : event.speedBytesPerSec && event.speedBytesPerSec > 0
        ? t('runtimeConfig.localModelCenter.downloadProgressWithEta', {
          speed: formatSpeed(event.speedBytesPerSec),
          eta: formatEta(event.etaSeconds),
          defaultValue: '{{speed}} · ETA {{eta}}',
        })
        : t('runtimeConfig.localModelCenter.measuringThroughput', { defaultValue: 'Measuring throughput...' });

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
      <div className="mb-2 flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]'}`}>
          <DownloadIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{event.modelId}</p>
          <p className="text-xs text-[var(--nimi-text-muted)]">{phaseLabel}</p>
          {event.phase !== 'download' && event.message ? <p className="truncate text-[length:var(--nimi-type-caption-size)] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{event.message}</p> : null}
        </div>
        <span className={`rounded-full px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-medium ${
          isFailed ? 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]' :
          isPaused ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' :
          isRunning ? 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]' :
          'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]'
        }`}>
          {downloadStateLabel(event.state, t)}
        </span>
        {isFailed || isCancelled ? (
          <button
            type="button"
            aria-label={t('runtimeConfig.localModelCenter.dismissTransfer', { defaultValue: 'Dismiss transfer' })}
            className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-surface-hover)] hover:text-[var(--nimi-text-secondary)]"
            onClick={() => props.onDismiss(event.installSessionId)}
          >
            {'\u00d7'}
          </button>
        ) : null}
      </div>
      {typeof event.bytesTotal === 'number' && event.bytesTotal > 0 ? (
        <div className="mb-2">
          <ProgressIndicator
            value={event.bytesReceived}
            max={event.bytesTotal}
            className={isFailed ? '[&_.nimi-progress__bar]:bg-[var(--nimi-status-danger)]' : undefined}
          />
          <div className="mt-1 flex justify-between text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
            <span>{formatBytes(event.bytesReceived)} / {formatBytes(event.bytesTotal)}</span>
            {isRunning ? (
              <span>{progressMeta}</span>
            ) : isPaused ? (
              <span>{pausedMetaLabel}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mb-2 text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.localModelCenter.downloadedBytes', {
            value: formatBytes(event.bytesReceived),
            defaultValue: '{{value}} downloaded',
          })}
        </p>
      )}
      <div className="flex items-center gap-2">
        {canPause ? <button type="button" disabled={props.runtimeWritesDisabled} onClick={() => props.onPause(event.installSessionId)} className="rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50">{t('runtimeConfig.localModelCenter.pause', { defaultValue: 'Pause' })}</button> : null}
        {canResume ? <Button size="sm" disabled={props.runtimeWritesDisabled} onClick={() => props.onResume(event.installSessionId)}>{t('runtimeConfig.localModelCenter.resume', { defaultValue: 'Resume' })}</Button> : null}
        {canCancel ? <button type="button" disabled={props.runtimeWritesDisabled} onClick={() => props.onCancel(event.installSessionId)} className="rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] hover:text-[var(--nimi-status-danger)] disabled:opacity-50">{t('Common.cancel', { defaultValue: 'Cancel' })}</button> : null}
      </div>
    </div>
  );
}

function LocalTransferImportCard(props: TransferCardProps) {
  const { event, t } = props;
  const isRunning = event.state === 'running';
  const isPaused = event.state === 'paused';
  const isFailed = event.state === 'failed';
  const isCancelled = event.state === 'cancelled';
  const canCancel = event.state === 'queued' || isRunning || isPaused;
  const phaseLabel = formatImportPhaseLabel(event.phase, t);
  const pausedMetaLabel = t('runtimeConfig.localModelCenter.downloadState.paused', { defaultValue: 'Paused' });
  const progressMeta = event.phase === 'register'
    || event.phase === 'manifest'
    ? t('runtimeConfig.localModelCenter.finalizingImport', { defaultValue: 'Finalizing local import...' })
    : event.speedBytesPerSec && event.speedBytesPerSec > 0
      ? t('runtimeConfig.localModelCenter.importProgressWithEta', {
        speed: formatSpeed(event.speedBytesPerSec),
        eta: formatEta(event.etaSeconds),
        defaultValue: '{{speed}} · ETA {{eta}}',
      })
      : t('runtimeConfig.localModelCenter.processingLocalImport', { defaultValue: 'Processing local import...' });

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
      <div className="mb-2 flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'}`}>
          <FolderOpenIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{event.modelId}</p>
          <p className="text-xs text-[var(--nimi-text-muted)]">{phaseLabel}</p>
          <p className="truncate text-[length:var(--nimi-type-caption-size)] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
            {event.message || t('runtimeConfig.localModelCenter.localImportSession', { defaultValue: 'Importing local file into managed storage.' })}
          </p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-medium ${
          isFailed ? 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]' :
          isPaused ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' :
          isRunning ? 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]' :
          'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]'
        }`}>
          {downloadStateLabel(event.state, t)}
        </span>
        {isFailed || isCancelled ? (
          <button
            type="button"
            aria-label={t('runtimeConfig.localModelCenter.dismissTransfer', { defaultValue: 'Dismiss transfer' })}
            className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] hover:text-[var(--nimi-text-secondary)]"
            onClick={() => props.onDismiss(event.installSessionId)}
          >
            {'\u00d7'}
          </button>
        ) : null}
        {isRunning ? (
          <button
            type="button"
            disabled={props.runtimeWritesDisabled}
            className="ml-1 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] disabled:opacity-50"
            onClick={() => props.onPause(event.installSessionId)}
          >
            {t('runtimeConfig.localModelCenter.pause', { defaultValue: 'Pause' })}
          </button>
        ) : null}
        {isPaused ? (
          <Button size="sm" disabled={props.runtimeWritesDisabled} onClick={() => props.onResume(event.installSessionId)}>
            {t('runtimeConfig.localModelCenter.resume', { defaultValue: 'Resume' })}
          </Button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={props.runtimeWritesDisabled}
            className="ml-1 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] hover:text-[var(--nimi-status-danger)] disabled:opacity-50"
            onClick={() => props.onCancel(event.installSessionId)}
          >
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
        ) : null}
      </div>
      {typeof event.bytesTotal === 'number' && event.bytesTotal > 0 ? (
        <div className="mb-2">
          <ProgressIndicator
            value={event.bytesReceived}
            max={event.bytesTotal}
            className={isFailed
              ? '[&_.nimi-progress__bar]:bg-[var(--nimi-status-danger)]'
              : '[&_.nimi-progress__bar]:bg-[var(--nimi-status-success)]'}
          />
          <div className="mt-1 flex justify-between text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
            <span>{formatBytes(event.bytesReceived)} / {formatBytes(event.bytesTotal)}</span>
            {isRunning ? (
              <span>{progressMeta}</span>
            ) : isPaused ? (
              <span>{pausedMetaLabel}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mb-2 text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.localModelCenter.localImportProgress', {
            value: formatBytes(event.bytesReceived),
            defaultValue: '{{value}} processed locally',
          })}
        </p>
      )}
    </div>
  );
}

function LocalAssetTaskCard(props: {
  task: AssetTaskEntry;
  pendingRetry: boolean;
  isAssetInstalled: (assetId: string) => boolean;
  t: TFunction;
  runtimeWritesDisabled: boolean;
  onRetryTask: (templateId: string) => void;
  onDismissTask: (templateId: string) => void;
}) {
  const { task, t } = props;
  // Render-layer reconciliation: the runtime queues catalog asset installs, so a
  // task can stay 'running' forever. Once the asset shows up in the installed
  // inventory, present the task as installed and auto-dismiss it shortly after.
  const installed = props.isAssetInstalled(task.assetId);
  const effectiveState: AssetTaskEntry['state'] = installed ? 'completed' : task.state;
  useEffect(() => {
    if (!installed) {
      return undefined;
    }
    const timer = setTimeout(() => props.onDismissTask(task.templateId), 5000);
    return () => clearTimeout(timer);
  }, [installed, props.onDismissTask, task.templateId]);
  const isRunning = effectiveState === 'running';
  const isFailed = effectiveState === 'failed';
  const isTerminal = isAssetTaskTerminal(effectiveState);
  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
          isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : isRunning ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'
        }`}>
          <FolderOpenIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{task.title}</p>
            <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
              {localizedAssetKindLabel(task.kind, t)}
            </span>
          </div>
          <p className="truncate text-xs text-[var(--nimi-text-muted)]">{task.assetId}</p>
          {task.detail && !installed ? <p className={`mt-0.5 truncate text-[length:var(--nimi-type-caption-size)] ${isFailed ? 'text-[var(--nimi-status-danger)]' : 'text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]'}`}>{task.detail}</p> : null}
        </div>
        <span className={`rounded-full px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-medium ${
          isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : isRunning ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'
        }`}>
          {assetTaskStatusLabel(effectiveState, t)}
        </span>
        {isTerminal ? (
          <button
            type="button"
            aria-label={t('runtimeConfig.localModelCenter.dismissTransfer', { defaultValue: 'Dismiss transfer' })}
            className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-surface-hover)] hover:text-[var(--nimi-text-secondary)]"
            onClick={() => props.onDismissTask(task.templateId)}
          >
            {'\u00d7'}
          </button>
        ) : null}
      </div>
      {isFailed && task.taskKind === 'catalog-install' ? (
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            onClick={() => props.onRetryTask(task.templateId)}
            disabled={props.pendingRetry || props.runtimeWritesDisabled}
            className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[var(--nimi-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
          >
            {props.pendingRetry
              ? t('runtimeConfig.localModelCenter.retrying', { defaultValue: 'Retrying...' })
              : t('runtimeConfig.localModelCenter.retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      ) : null}
    </div>
  );
}

type InProgressSectionProps = {
  downloads: NimiRuntimeLocalTransferProgressEvent[];
  imports: NimiRuntimeLocalTransferProgressEvent[];
  terminalDownloads: NimiRuntimeLocalTransferProgressEvent[];
  terminalImports: NimiRuntimeLocalTransferProgressEvent[];
  tasks: AssetTaskEntry[];
  pendingTemplateIds: string[];
  isAssetInstalled: (assetId: string) => boolean;
  runtimeWritesDisabled: boolean;
  onPause: (installSessionId: string) => void;
  onResume: (installSessionId: string) => void;
  onCancel: (installSessionId: string) => void;
  onDismiss: (installSessionId: string) => void;
  onRetryTask: (templateId: string) => void;
  onDismissTask: (templateId: string) => void;
};

function LocalModelCenterInProgressSection(props: InProgressSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const [recentOpen, setRecentOpen] = useState(false);
  const activeAssetTasks = props.tasks.filter((task) => !isAssetTaskTerminal(task.state));
  const terminalAssetTasks = props.tasks.filter((task) => isAssetTaskTerminal(task.state));
  const activeCount = props.downloads.length + props.imports.length + activeAssetTasks.length;
  const terminalCount = props.terminalDownloads.length + props.terminalImports.length + terminalAssetTasks.length;
  if (activeCount === 0 && terminalCount === 0) {
    return null;
  }

  const clearAllTerminal = () => {
    for (const event of [...props.terminalDownloads, ...props.terminalImports]) {
      props.onDismiss(event.installSessionId);
    }
    for (const task of terminalAssetTasks) {
      props.onDismissTask(task.templateId);
    }
  };

  const transferCardCallbacks = {
    t,
    runtimeWritesDisabled: props.runtimeWritesDisabled,
    onPause: props.onPause,
    onResume: props.onResume,
    onCancel: props.onCancel,
    onDismiss: props.onDismiss,
  };

  return (
    <section className="overflow-visible rounded-2xl bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)] ring-1 ring-[var(--nimi-border-subtle)]">
      <div className="flex items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]">
          <DownloadIcon className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.localModelCenter.inProgress', { defaultValue: 'In Progress' })}
        </h3>
        {activeCount > 0 ? (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--nimi-action-primary-bg)]">
            {activeCount}
          </span>
        ) : null}
      </div>
      {activeCount > 0 ? (
        <div className="space-y-3 px-5 py-4">
          {props.downloads.map((event) => (
            <LocalTransferDownloadCard key={event.installSessionId} event={event} {...transferCardCallbacks} />
          ))}
          {props.imports.map((event) => (
            <LocalTransferImportCard key={event.installSessionId} event={event} {...transferCardCallbacks} />
          ))}
          {activeAssetTasks.map((task) => (
            <LocalAssetTaskCard
              key={`asset-task-${task.templateId}`}
              task={task}
              pendingRetry={props.pendingTemplateIds.includes(task.templateId)}
              isAssetInstalled={props.isAssetInstalled}
              t={t}
              runtimeWritesDisabled={props.runtimeWritesDisabled}
              onRetryTask={props.onRetryTask}
              onDismissTask={props.onDismissTask}
            />
          ))}
        </div>
      ) : null}
      {terminalCount > 0 ? (
        <div className={activeCount > 0 ? 'border-t border-[var(--nimi-border-subtle)]' : ''}>
          <div className="flex items-center justify-between px-5 py-3">
            <button
              type="button"
              onClick={() => setRecentOpen((value) => !value)}
              aria-expanded={recentOpen}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]"
            >
              <span aria-hidden="true" className={`inline-block transition-transform ${recentOpen ? 'rotate-90' : ''}`}>{'\u25b8'}</span>
              {t('runtimeConfig.localModelCenter.recentTasks', {
                count: terminalCount,
                defaultValue: 'Recent Tasks ({{count}})',
              })}
            </button>
            <button
              type="button"
              onClick={clearAllTerminal}
              className="text-xs font-medium text-[var(--nimi-text-muted)] hover:text-[var(--nimi-status-danger)]"
            >
              {t('runtimeConfig.localModelCenter.clearAll', { defaultValue: 'Clear all' })}
            </button>
          </div>
          {recentOpen ? (
            <div className="space-y-3 px-5 pb-4">
              {props.terminalDownloads.map((event) => (
                <LocalTransferDownloadCard key={event.installSessionId} event={event} {...transferCardCallbacks} />
              ))}
              {props.terminalImports.map((event) => (
                <LocalTransferImportCard key={event.installSessionId} event={event} {...transferCardCallbacks} />
              ))}
              {terminalAssetTasks.map((task) => (
                <LocalAssetTaskCard
                  key={`asset-task-${task.templateId}`}
                  task={task}
                  pendingRetry={props.pendingTemplateIds.includes(task.templateId)}
                  isAssetInstalled={props.isAssetInstalled}
                  t={t}
                  runtimeWritesDisabled={props.runtimeWritesDisabled}
                  onRetryTask={props.onRetryTask}
                  onDismissTask={props.onDismissTask}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export {
  LocalModelCenterInProgressSection,
};
