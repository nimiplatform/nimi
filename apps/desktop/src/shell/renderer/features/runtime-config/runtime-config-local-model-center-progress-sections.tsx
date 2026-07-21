import { i18n } from '../../i18n';
import type { NimiRuntimeLocalTransferProgressEvent } from '@nimiplatform/sdk/runtime';
import {
  FolderOpenIcon,
  DownloadIcon,
  assetTaskStatusLabel,
  formatAssetKindLabel,
  type AssetTaskEntry,
} from './runtime-config-local-model-center-helpers';
import {
  downloadStateLabel,
  formatBytes,
  formatDownloadPhaseLabel,
  formatEta,
  formatImportPhaseLabel,
  formatSpeed,
} from './runtime-config-model-center-utils';

type ActiveDownloadsSectionProps = {
  downloads: NimiRuntimeLocalTransferProgressEvent[];
  onPause: (installSessionId: string) => void;
  onResume: (installSessionId: string) => void;
  onCancel: (installSessionId: string) => void;
};

function LocalModelCenterActiveDownloadsSection(props: ActiveDownloadsSectionProps) {
  if (props.downloads.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
        {i18n.t('runtimeConfig.localModelCenter.activeDownloads', {
          count: props.downloads.length,
          defaultValue: 'Active Downloads ({{count}})',
        })}
      </h3>
      {props.downloads.map((event) => {
        const isRunning = event.state === 'running';
        const isPaused = event.state === 'paused';
        const isFailed = event.state === 'failed';
        const canPause = event.state === 'queued' || isRunning;
        const canResume = isPaused || (isFailed && event.retryable);
        const canCancel = event.state !== 'completed' && event.state !== 'cancelled';
        const phaseLabel = formatDownloadPhaseLabel(event.phase);
        const progressMeta = event.phase === 'verify'
          ? (event.speedBytesPerSec && event.speedBytesPerSec > 0
              ? i18n.t('runtimeConfig.localModelCenter.verifyProgressWithEta', {
                speed: formatSpeed(event.speedBytesPerSec),
                eta: formatEta(event.etaSeconds),
                defaultValue: '{{speed}} verify · ETA {{eta}}',
              })
              : i18n.t('runtimeConfig.localModelCenter.verifyingLocalFile', { defaultValue: 'Verifying local file...' }))
          : event.phase === 'upsert'
            ? i18n.t('runtimeConfig.localModelCenter.finalizingInstallation', { defaultValue: 'Finalizing installation...' })
            : event.speedBytesPerSec && event.speedBytesPerSec > 0
              ? i18n.t('runtimeConfig.localModelCenter.downloadProgressWithEta', {
                speed: formatSpeed(event.speedBytesPerSec),
                eta: formatEta(event.etaSeconds),
                defaultValue: '{{speed}} · ETA {{eta}}',
              })
              : i18n.t('runtimeConfig.localModelCenter.measuringThroughput', { defaultValue: 'Measuring throughput...' });

        return (
          <div key={event.installSessionId} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
            <div className="mb-2 flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]'}`}>
                <DownloadIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{event.modelId}</p>
                <p className="text-xs text-[var(--nimi-text-muted)]">{phaseLabel}</p>
                {event.phase !== 'download' && event.message ? <p className="truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{event.message}</p> : null}
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' :
                isPaused ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]' :
                isRunning ? 'bg-[color-mix(in_srgb,var(--nimi-status-info)_18%,transparent)] text-[var(--nimi-status-info)]' :
                'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]'
              }`}>
                {downloadStateLabel(event.state)}
              </span>
            </div>
            {typeof event.bytesTotal === 'number' && event.bytesTotal > 0 ? (
              <div className="mb-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
                  <div
                    className={`h-full transition-all ${isFailed ? 'bg-[var(--nimi-status-danger)]' : 'bg-[var(--nimi-action-primary-bg)]'}`}
                    style={{ width: `${Math.max(0, Math.min(100, Math.round((event.bytesReceived / event.bytesTotal) * 100)))}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-[var(--nimi-text-muted)]">
                  <span>{formatBytes(event.bytesReceived)} / {formatBytes(event.bytesTotal)}</span>
                  {isRunning ? <span>{progressMeta}</span> : null}
                </div>
              </div>
            ) : (
              <p className="mb-2 text-xs text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.downloadedBytes', {
                  value: formatBytes(event.bytesReceived),
                  defaultValue: '{{value}} downloaded',
                })}
              </p>
            )}
            <div className="flex items-center gap-2">
              {canPause ? <button type="button" onClick={() => props.onPause(event.installSessionId)} className="rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]">{i18n.t('runtimeConfig.localModelCenter.pause', { defaultValue: 'Pause' })}</button> : null}
              {canResume ? <button type="button" onClick={() => props.onResume(event.installSessionId)} className="rounded bg-[var(--nimi-action-primary-bg)] px-2 py-1 text-xs text-white hover:bg-[var(--nimi-action-primary-bg-hover)]">{i18n.t('runtimeConfig.localModelCenter.resume', { defaultValue: 'Resume' })}</button> : null}
              {canCancel ? <button type="button" onClick={() => props.onCancel(event.installSessionId)} className="rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] hover:text-[var(--nimi-status-danger)]">{i18n.t('Common.cancel', { defaultValue: 'Cancel' })}</button> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type ActiveImportsSectionProps = {
  imports: NimiRuntimeLocalTransferProgressEvent[];
  onDismiss: (installSessionId: string) => void;
};

function LocalModelCenterActiveImportsSection(props: ActiveImportsSectionProps) {
  if (props.imports.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
        {i18n.t('runtimeConfig.localModelCenter.activeImports', {
          count: props.imports.length,
          defaultValue: 'Active Imports ({{count}})',
        })}
      </h3>
      {props.imports.map((event) => {
        const isRunning = event.state === 'running';
        const isPaused = event.state === 'paused';
        const isFailed = event.state === 'failed';
        const phaseLabel = formatImportPhaseLabel(event.phase);
        const progressMeta = event.phase === 'register'
          || event.phase === 'manifest'
          ? i18n.t('runtimeConfig.localModelCenter.finalizingImport', { defaultValue: 'Finalizing local import...' })
          : event.speedBytesPerSec && event.speedBytesPerSec > 0
            ? i18n.t('runtimeConfig.localModelCenter.importProgressWithEta', {
              speed: formatSpeed(event.speedBytesPerSec),
              eta: formatEta(event.etaSeconds),
              defaultValue: '{{speed}} · ETA {{eta}}',
            })
            : i18n.t('runtimeConfig.localModelCenter.processingLocalImport', { defaultValue: 'Processing local import...' });

        return (
          <div key={event.installSessionId} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
            <div className="mb-2 flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'}`}>
                <FolderOpenIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{event.modelId}</p>
                <p className="text-xs text-[var(--nimi-text-muted)]">{phaseLabel}</p>
                <p className="truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
                  {event.message || i18n.t('runtimeConfig.localModelCenter.localImportSession', { defaultValue: 'Importing local file into managed storage.' })}
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' :
                isPaused ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]' :
                isRunning ? 'bg-[color-mix(in_srgb,var(--nimi-status-info)_18%,transparent)] text-[var(--nimi-status-info)]' :
                'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]'
              }`}>
                {downloadStateLabel(event.state)}
              </span>
              {isFailed ? (
                <button
                  type="button"
                  className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] hover:text-[var(--nimi-text-secondary)]"
                  onClick={() => props.onDismiss(event.installSessionId)}
                >
                  {'\u00d7'}
                </button>
              ) : null}
            </div>
            {typeof event.bytesTotal === 'number' && event.bytesTotal > 0 ? (
              <div className="mb-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
                  <div
                    className={`h-full transition-all ${isFailed ? 'bg-[var(--nimi-status-danger)]' : 'bg-[var(--nimi-status-success)]'}`}
                    style={{ width: `${Math.max(0, Math.min(100, Math.round((event.bytesReceived / event.bytesTotal) * 100)))}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-[var(--nimi-text-muted)]">
                  <span>{formatBytes(event.bytesReceived)} / {formatBytes(event.bytesTotal)}</span>
                  {(isRunning || isPaused) ? <span>{progressMeta}</span> : null}
                </div>
              </div>
            ) : (
              <p className="mb-2 text-xs text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.localImportProgress', {
                  value: formatBytes(event.bytesReceived),
                  defaultValue: '{{value}} processed locally',
                })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

type AssetTasksSectionProps = {
  tasks: AssetTaskEntry[];
  pendingTemplateIds: string[];
  onRetryTask: (templateId: string) => void;
};

function LocalModelCenterAssetTasksSection(props: AssetTasksSectionProps) {
  if (props.tasks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
        {i18n.t('runtimeConfig.localModelCenter.assetTasks', {
          count: props.tasks.length,
          defaultValue: 'Asset Tasks ({{count}})',
        })}
      </h3>
      <div className="grid grid-cols-1 gap-3">
        {props.tasks.map((task) => {
          const isRunning = task.state === 'running';
          const isFailed = task.state === 'failed';
          const pendingRetry = props.pendingTemplateIds.includes(task.templateId);
          return (
            <div key={`asset-task-${task.templateId}`} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : isRunning ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'
                }`}>
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{task.title}</p>
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">
                      {formatAssetKindLabel(task.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[var(--nimi-text-muted)]">{task.assetId}</p>
                  {task.detail ? <p className={`mt-0.5 truncate text-[11px] ${isFailed ? 'text-[var(--nimi-status-danger)]' : 'text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]'}`}>{task.detail}</p> : null}
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                  isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : isRunning ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'
                }`}>
                  {assetTaskStatusLabel(task.state)}
                </span>
              </div>
              {isFailed && task.taskKind === 'verified-install' ? (
                <div className="mt-3 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => props.onRetryTask(task.templateId)}
                    disabled={pendingRetry}
                    className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[var(--nimi-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
                  >
                    {pendingRetry
                      ? i18n.t('runtimeConfig.localModelCenter.retrying', { defaultValue: 'Retrying...' })
                      : i18n.t('runtimeConfig.localModelCenter.retry', { defaultValue: 'Retry' })}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export {
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterAssetTasksSection,
};
