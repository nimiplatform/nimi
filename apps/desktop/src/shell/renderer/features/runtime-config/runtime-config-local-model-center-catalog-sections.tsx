import { i18n } from '@renderer/i18n';
import { toCanonicalLocalLookupKey } from '@runtime/local-runtime/local-id';
import type {
  LocalRuntimeArtifactRecord,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeVerifiedModelDescriptor,
} from '@runtime/local-runtime';
import {
  DownloadIcon,
  FolderOpenIcon,
  artifactTaskStatusLabel,
  formatArtifactKindLabel,
  isRecommendedDescriptor,
  RefreshIcon,
  StarIcon,
  type ArtifactTaskEntry,
} from './runtime-config-local-model-center-helpers';
import {
  downloadStateLabel,
  formatBytes,
  formatDownloadPhaseLabel,
  formatEta,
  formatSpeed,
} from './runtime-config-model-center-utils';

type ArtifactRequirementBadgesProps = {
  modelTemplateId: string;
  relatedArtifacts: LocalRuntimeVerifiedArtifactDescriptor[];
  installedArtifactsById: Map<string, LocalRuntimeArtifactRecord>;
  artifactBusy: boolean;
  isArtifactPending: (templateId: string) => boolean;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedArtifactDescriptor[]) => void;
  onInstallArtifact: (templateId: string) => void;
};

function ArtifactRequirementBadges(props: ArtifactRequirementBadgesProps) {
  if (props.relatedArtifacts.length === 0) {
    return null;
  }

  const missingArtifacts = props.relatedArtifacts.filter((artifact) => (
    !props.installedArtifactsById.has(toCanonicalLocalLookupKey(artifact.artifactId))
  ));
  const hasPendingMissingArtifacts = missingArtifacts.some((artifact) => props.isArtifactPending(artifact.templateId));

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {missingArtifacts.length > 1 ? (
        <button
          type="button"
          onClick={() => props.onInstallMissingArtifacts(props.relatedArtifacts)}
          disabled={props.artifactBusy || hasPendingMissingArtifacts}
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
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
        const installed = props.installedArtifactsById.get(toCanonicalLocalLookupKey(artifact.artifactId)) || null;
        const pending = props.isArtifactPending(artifact.templateId);
        return (
          <div
            key={`${props.modelTemplateId}-${artifact.templateId}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
              installed
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            <span>{formatArtifactKindLabel(artifact.kind)}</span>
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
                className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-white disabled:opacity-50"
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
  visibleVerifiedArtifacts: LocalRuntimeVerifiedArtifactDescriptor[];
  isArtifactPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallArtifact: (templateId: string) => void;
};

function LocalModelCenterVerifiedArtifactsSection(props: VerifiedArtifactsSectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {i18n.t('runtimeConfig.localModelCenter.verifiedCompanionAssets', { defaultValue: 'Verified Companion Assets' })}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loadingVerifiedArtifacts || props.artifactBusy}
          className="flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      {props.loadingVerifiedArtifacts ? (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-500">
            {i18n.t('runtimeConfig.localModelCenter.loadingVerifiedArtifacts', { defaultValue: 'Loading verified artifacts...' })}
          </p>
        </div>
      ) : props.visibleVerifiedArtifacts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.visibleVerifiedArtifacts.slice(0, props.hasSearchQuery ? 12 : 6).map((artifact) => {
            const pending = props.isArtifactPending(artifact.templateId);
            return (
              <div key={artifact.templateId} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 transition-colors hover:border-mint-200 hover:bg-mint-50/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 text-[11px] font-semibold text-white">
                  {formatArtifactKindLabel(artifact.kind).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{artifact.title}</p>
                    {isRecommendedDescriptor(artifact.tags) ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                      </span>
                    ) : null}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {formatArtifactKindLabel(artifact.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-gray-500">{artifact.artifactId}</p>
                  {artifact.description ? <p className="mt-0.5 truncate text-[11px] text-gray-400">{artifact.description}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => props.onInstallArtifact(artifact.templateId)}
                  disabled={props.artifactBusy || pending}
                  className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600 disabled:opacity-50"
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
          <p className="text-sm text-gray-500">
            {props.hasSearchQuery
              ? i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsMatchSearch', { defaultValue: 'No verified companion assets matched your search.' })
              : i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsForFilter', { defaultValue: 'No verified companion assets available for the current filter.' })}
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
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
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-red-100 text-red-600' : 'bg-mint-100 text-mint-600'}`}>
                <DownloadIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{event.modelId}</p>
                <p className="text-xs text-gray-500">{phaseLabel}</p>
                {event.phase !== 'download' && event.message ? <p className="truncate text-[11px] text-gray-400">{event.message}</p> : null}
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                isFailed ? 'bg-red-100 text-red-700' :
                isPaused ? 'bg-amber-100 text-amber-700' :
                isRunning ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {downloadStateLabel(event.state)}
              </span>
            </div>
            {typeof event.bytesTotal === 'number' && event.bytesTotal > 0 ? (
              <div className="mb-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full transition-all ${isFailed ? 'bg-red-500' : 'bg-mint-500'}`}
                    style={{ width: `${Math.max(0, Math.min(100, Math.round((event.bytesReceived / event.bytesTotal) * 100)))}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-gray-500">
                  <span>{formatBytes(event.bytesReceived)} / {formatBytes(event.bytesTotal)}</span>
                  {isRunning ? <span>{progressMeta}</span> : null}
                </div>
              </div>
            ) : (
              <p className="mb-2 text-xs text-gray-500">
                {i18n.t('runtimeConfig.localModelCenter.downloadedBytes', {
                  value: formatBytes(event.bytesReceived),
                  defaultValue: '{{value}} downloaded',
                })}
              </p>
            )}
            <div className="flex items-center gap-2">
              {canPause ? <button type="button" onClick={() => props.onPause(event.installSessionId)} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">{i18n.t('runtimeConfig.localModelCenter.pause', { defaultValue: 'Pause' })}</button> : null}
              {canResume ? <button type="button" onClick={() => props.onResume(event.installSessionId)} className="rounded bg-mint-500 px-2 py-1 text-xs text-white hover:bg-mint-600">{i18n.t('runtimeConfig.localModelCenter.resume', { defaultValue: 'Resume' })}</button> : null}
              {canCancel ? <button type="button" onClick={() => props.onCancel(event.installSessionId)} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-red-200 hover:text-red-600">{i18n.t('Common.cancel', { defaultValue: 'Cancel' })}</button> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type ArtifactTasksSectionProps = {
  tasks: ArtifactTaskEntry[];
  pendingTemplateIds: string[];
  onRetryTask: (templateId: string) => void;
};

function LocalModelCenterArtifactTasksSection(props: ArtifactTasksSectionProps) {
  if (props.tasks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
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
                  isFailed ? 'bg-red-100 text-red-600' : isRunning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                }`}>
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{task.title}</p>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {formatArtifactKindLabel(task.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-gray-500">{task.artifactId}</p>
                  {task.detail ? <p className={`mt-0.5 truncate text-[11px] ${isFailed ? 'text-red-500' : 'text-gray-400'}`}>{task.detail}</p> : null}
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                  isFailed ? 'bg-red-100 text-red-700' : isRunning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                }`}>
                  {artifactTaskStatusLabel(task.state)}
                </span>
              </div>
              {isFailed && task.taskKind === 'verified-install' ? (
                <div className="mt-3 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => props.onRetryTask(task.templateId)}
                    disabled={pendingRetry}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
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
  verifiedModels: LocalRuntimeVerifiedModelDescriptor[];
  relatedArtifactsByModelTemplate: Map<string, LocalRuntimeVerifiedArtifactDescriptor[]>;
  installedArtifactsById: Map<string, LocalRuntimeArtifactRecord>;
  isArtifactPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onInstallArtifact: (templateId: string) => void;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedArtifactDescriptor[]) => void;
};

function LocalModelCenterQuickPicksSection(props: QuickPicksSectionProps) {
  if (props.verifiedModels.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StarIcon className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {i18n.t('runtimeConfig.localModelCenter.quickPicks', { defaultValue: 'Quick Picks' })}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loadingVerifiedModels}
          className="flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {props.verifiedModels.map((item) => {
          const relatedArtifacts = props.relatedArtifactsByModelTemplate.get(item.templateId) || [];
          return (
            <div key={item.templateId} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 transition-colors hover:border-mint-200 hover:bg-mint-50/30">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                <StarIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                  {isRecommendedDescriptor(item.tags) ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                      {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-gray-500">{item.modelId}</p>
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
                className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600 disabled:opacity-50"
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
  LocalModelCenterArtifactTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedArtifactsSection,
};
