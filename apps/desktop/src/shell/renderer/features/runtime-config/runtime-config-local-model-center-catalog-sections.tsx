import { i18n } from '@renderer/i18n';
import { toCanonicalLocalLookupKey } from '@runtime/local-runtime/local-id';
import type {
  LocalRuntimeAssetRecord,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeVerifiedAssetDescriptor,
} from '@runtime/local-runtime';
import {
  DownloadIcon,
  FolderOpenIcon,
  assetTaskStatusLabel,
  formatAssetKindLabel,
  isRecommendedDescriptor,
  RefreshIcon,
  StarIcon,
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

type ArtifactRequirementBadgesProps = {
  modelTemplateId: string;
  relatedArtifacts: LocalRuntimeVerifiedAssetDescriptor[];
  installedArtifactsById: Map<string, LocalRuntimeAssetRecord>;
  artifactBusy: boolean;
  isArtifactPending: (templateId: string) => boolean;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedAssetDescriptor[]) => void;
  onInstallArtifact: (templateId: string) => void;
};

function ArtifactRequirementBadges(props: ArtifactRequirementBadgesProps) {
  if (props.relatedArtifacts.length === 0) {
    return null;
  }

  const missingArtifacts = props.relatedArtifacts.filter((artifact) => (
    !props.installedArtifactsById.has(toCanonicalLocalLookupKey(artifact.assetId))
  ));
  const hasPendingMissingArtifacts = missingArtifacts.some((artifact) => props.isArtifactPending(artifact.templateId));

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {missingArtifacts.length > 1 ? (
        <button
          type="button"
          onClick={() => props.onInstallMissingArtifacts(props.relatedArtifacts)}
          disabled={props.artifactBusy || hasPendingMissingArtifacts}
          className="inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] disabled:opacity-50"
        >
          {hasPendingMissingArtifacts
            ? i18n.t('runtimeConfig.localModelCenter.installingAssets', { defaultValue: 'Installing assets...' })
            : i18n.t('runtimeConfig.localModelCenter.installMissing', {
              count: missingArtifacts.length,
              defaultValue: 'Install Missing ({{count}})',
            })}
        </button>
      ) : null}
      {props.relatedArtifacts.map((artifact) => {
        const installed = props.installedArtifactsById.get(toCanonicalLocalLookupKey(artifact.assetId)) || null;
        const pending = props.isArtifactPending(artifact.templateId);
        return (
          <div
            key={`${props.modelTemplateId}-${artifact.templateId}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
              installed
                ? 'border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]'
                : 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]'
            }`}
          >
            <span>{formatAssetKindLabel(artifact.kind)}</span>
            <span>
              {installed
                ? i18n.t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' })
                : pending
                  ? i18n.t('runtimeConfig.localModelCenter.installingShort', { defaultValue: 'Installing' })
                  : i18n.t('runtimeConfig.localModelCenter.required', { defaultValue: 'Required' })}
            </span>
            {!installed ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onInstallArtifact(artifact.templateId);
                }}
                disabled={props.artifactBusy || pending}
                className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-[var(--nimi-status-warning)] hover:bg-white disabled:opacity-50"
              >
                {pending
                  ? i18n.t('runtimeConfig.localModelCenter.installing', { defaultValue: 'Installing...' })
                  : i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type VerifiedArtifactsSectionProps = {
  hasSearchQuery: boolean;
  loadingVerifiedArtifacts: boolean;
  artifactBusy: boolean;
  visibleVerifiedArtifacts: LocalRuntimeVerifiedAssetDescriptor[];
  isArtifactPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallArtifact: (templateId: string) => void;
};

function LocalModelCenterVerifiedArtifactsSection(props: VerifiedArtifactsSectionProps) {
  return (
    <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="h-4 w-4 text-[var(--nimi-text-muted)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.verifiedCompanionAssets', { defaultValue: 'Verified Dependency Assets' })}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loadingVerifiedArtifacts || props.artifactBusy}
          className="flex items-center gap-1.5 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      {props.loadingVerifiedArtifacts ? (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.loadingVerifiedArtifacts', { defaultValue: 'Loading verified assets...' })}
          </p>
        </div>
      ) : props.visibleVerifiedArtifacts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.visibleVerifiedArtifacts.slice(0, props.hasSearchQuery ? 12 : 6).map((artifact) => {
            const pending = props.isArtifactPending(artifact.templateId);
            return (
              <div key={artifact.templateId} className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] p-3 transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 text-[11px] font-semibold text-white">
                  {formatAssetKindLabel(artifact.kind).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{artifact.title}</p>
                    {isRecommendedDescriptor(artifact.tags) ? (
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-warning)]">
                        {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                      </span>
                    ) : null}
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">
                      {formatAssetKindLabel(artifact.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[var(--nimi-text-muted)]">{artifact.assetId}</p>
                  {artifact.description ? <p className="mt-0.5 truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{artifact.description}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => props.onInstallArtifact(artifact.templateId)}
                  disabled={props.artifactBusy || pending}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {pending
                    ? i18n.t('runtimeConfig.localModelCenter.installing', { defaultValue: 'Installing...' })
                    : i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--nimi-text-muted)]">
            {props.hasSearchQuery
              ? i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsMatchSearch', { defaultValue: 'No verified dependency assets matched your search.' })
              : i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsForFilter', { defaultValue: 'No verified dependency assets available for the current filter.' })}
          </p>
        </div>
      )}
    </div>
  );
}

type ActiveDownloadsSectionProps = {
  downloads: LocalRuntimeDownloadProgressEvent[];
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
          <div key={event.installSessionId} className="rounded-2xl bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.035)] ring-1 ring-black/[0.04]">
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
  imports: LocalRuntimeDownloadProgressEvent[];
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
          <div key={event.installSessionId} className="rounded-2xl bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.035)] ring-1 ring-black/[0.04]">
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

type ArtifactTasksSectionProps = {
  tasks: AssetTaskEntry[];
  pendingTemplateIds: string[];
  onRetryTask: (templateId: string) => void;
};

function LocalModelCenterArtifactTasksSection(props: ArtifactTasksSectionProps) {
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
            <div key={`artifact-task-${task.templateId}`} className="rounded-2xl bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.035)] ring-1 ring-black/[0.04]">
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
                    className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
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

type QuickPicksSectionProps = {
  loadingVerifiedModels: boolean;
  installing: boolean;
  artifactBusy: boolean;
  verifiedModels: LocalRuntimeVerifiedAssetDescriptor[];
  relatedArtifactsByModelTemplate: Map<string, LocalRuntimeVerifiedAssetDescriptor[]>;
  installedArtifactsById: Map<string, LocalRuntimeAssetRecord>;
  isArtifactPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onInstallArtifact: (templateId: string) => void;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedAssetDescriptor[]) => void;
};

function LocalModelCenterQuickPicksSection(props: QuickPicksSectionProps) {
  if (props.verifiedModels.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StarIcon className="h-4 w-4 text-[var(--nimi-status-warning)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.quickPicks', { defaultValue: 'Quick Picks' })}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loadingVerifiedModels}
          className="flex items-center gap-1.5 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {props.verifiedModels.map((item) => {
          const relatedArtifacts = props.relatedArtifactsByModelTemplate.get(item.templateId) || [];
          return (
            <div key={item.templateId} className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] p-3 transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                <StarIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{item.title}</p>
                  {isRecommendedDescriptor(item.tags) ? (
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-warning)]">
                      {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-[var(--nimi-text-muted)]">{item.assetId}</p>
                <ArtifactRequirementBadges
                  modelTemplateId={`${item.templateId}-quick`}
                  relatedArtifacts={relatedArtifacts}
                  installedArtifactsById={props.installedArtifactsById}
                  artifactBusy={props.artifactBusy}
                  isArtifactPending={props.isArtifactPending}
                  onInstallMissingArtifacts={props.onInstallMissingArtifacts}
                  onInstallArtifact={props.onInstallArtifact}
                />
              </div>
              <button
                type="button"
                onClick={() => props.onInstallVerifiedModel(item.templateId)}
                disabled={props.installing}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export {
  ArtifactRequirementBadges,
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterArtifactTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedArtifactsSection,
};
