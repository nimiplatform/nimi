import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { CSSProperties } from 'react';
import type { TFunction } from 'i18next';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  isNimiRuntimeLocalEnvironmentDependencyJobTransferringState,
  isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState,
  isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState,
  isNimiRuntimeLocalEnvironmentDependencyUnsupportedState,
} from '@nimiplatform/sdk/runtime';

import {
  formatBytes,
  formatEta,
  formatSpeed,
} from './runtime-config-model-center-utils';
import {
  runtimeDependencyCurrentState,
  runtimeDependencyJobForDisplay,
} from './runtime-config-local-model-center-runtime-dependency-state';

const RUNTIME_DEPENDENCY_STALE_MS = 5 * 60 * 1000;

function parseRuntimeDependencyTimestampMs(value: string | undefined): number {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function formatRuntimeDependencyDuration(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  if (safe < 60) {
    return `${safe}s`;
  }
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function runtimeDependencyJobIsStale(
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  nowMs: number,
): boolean {
  if (!job || !isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state)) {
    return false;
  }
  const updatedAtMs = parseRuntimeDependencyTimestampMs(job.updatedAt || job.createdAt);
  return updatedAtMs > 0 && nowMs - updatedAtMs >= RUNTIME_DEPENDENCY_STALE_MS;
}

function runtimeDependencyJobTimingSummary(
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  t: TFunction,
  nowMs: number,
): string {
  if (!job) {
    return '';
  }
  const createdAtMs = parseRuntimeDependencyTimestampMs(job.createdAt);
  const updatedAtMs = parseRuntimeDependencyTimestampMs(job.updatedAt || job.createdAt);
  const parts: string[] = [];
  if (createdAtMs > 0) {
    parts.push(t('runtimeConfig.localModelCenter.runtimeDependencyElapsed', {
      defaultValue: 'Elapsed {{value}}',
      value: formatRuntimeDependencyDuration(nowMs - createdAtMs),
    }));
  }
  if (updatedAtMs > 0) {
    parts.push(t('runtimeConfig.localModelCenter.runtimeDependencyLastUpdate', {
      defaultValue: 'Last update {{value}} ago',
      value: formatRuntimeDependencyDuration(nowMs - updatedAtMs),
    }));
  }
  return parts.join(' | ');
}

function runtimeDependencyStateStageLabel(state: string, t: TFunction, compact = false): string {
  switch (state) {
    case 'queued':
      return compact
        ? t('runtimeConfig.localModelCenter.runtimeStageQueuedCompact', { defaultValue: 'Waiting' })
        : t('runtimeConfig.localModelCenter.runtimeStageQueued', { defaultValue: 'Waiting to start local image runtime setup' });
    case 'running':
      return compact
        ? t('runtimeConfig.localModelCenter.runtimeStageRunningCompact', { defaultValue: 'Preparing runtime' })
        : t('runtimeConfig.localModelCenter.runtimeStageRunning', { defaultValue: 'Preparing local image runtime setup' });
    case 'downloading':
      return compact
        ? t('runtimeConfig.localModelCenter.runtimeStageDownloadingCompact', { defaultValue: 'Downloading runtime' })
        : t('runtimeConfig.localModelCenter.runtimeStageDownloading', { defaultValue: 'Downloading local image runtime package' });
    case 'verifying':
      return compact
        ? t('runtimeConfig.localModelCenter.runtimeStageVerifyingCompact', { defaultValue: 'Verifying runtime' })
        : t('runtimeConfig.localModelCenter.runtimeStageVerifying', { defaultValue: 'Verifying local image runtime package' });
    case 'installing':
    case 'applying':
      return compact
        ? t('runtimeConfig.localModelCenter.runtimeStageInstallingCompact', { defaultValue: 'Installing runtime' })
        : t('runtimeConfig.localModelCenter.runtimeStageInstalling', { defaultValue: 'Installing local image runtime' });
    default:
      return compact
        ? t('runtimeConfig.localModelCenter.runtimeStageActiveCompact', { defaultValue: 'Setting up runtime' })
        : t('runtimeConfig.localModelCenter.runtimeStageActive', { defaultValue: 'Setting up local image runtime' });
  }
}

export function runtimeDependencyProgressPercent(job?: NimiRuntimeLocalEnvironmentDependencyJob): number {
  if (!job || !isNimiRuntimeLocalEnvironmentDependencyJobTransferringState(job.state)) {
    return 0;
  }
  const percent = Number(job.percent);
  if (Number.isFinite(percent) && percent > 0) {
    return Math.max(0, Math.min(100, Math.round(percent)));
  }
  const received = Number(job.bytesReceived);
  const total = Number(job.bytesTotal);
  if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0 || received <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}

export function runtimeDependencyProgressSummary(
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  t: TFunction,
): string {
  if (!job || !isNimiRuntimeLocalEnvironmentDependencyJobTransferringState(job.state)) {
    return '';
  }
  const received = Number(job.bytesReceived);
  const total = Number(job.bytesTotal);
  const parts: string[] = [];
  if (Number.isFinite(total) && total > 0) {
    parts.push(`${formatBytes(received)} / ${formatBytes(total)}`);
  } else if (Number.isFinite(received) && received > 0) {
    parts.push(t('runtimeConfig.localModelCenter.runtimeDependencyDownloadedBytes', {
      defaultValue: '{{value}} received',
      value: formatBytes(received),
    }));
  }
  if (Number(job.speedBytesPerSec) > 0) {
    parts.push(formatSpeed(job.speedBytesPerSec));
  }
  if (Number(job.etaSeconds) > 0) {
    parts.push(t('runtimeConfig.localModelCenter.runtimeDependencyEta', {
      defaultValue: 'ETA {{value}}',
      value: formatEta(job.etaSeconds),
    }));
  }
  return parts.join(' | ');
}

function runtimeDependencyActiveDetail(
  job: NimiRuntimeLocalEnvironmentDependencyJob,
  t: TFunction,
): string {
  const state = runtimeDependencyStateStageLabel(job.state, t);
  const progress = runtimeDependencyProgressSummary(job, t);
  if (progress) {
    return `${state}. ${progress}.`;
  }
  if (job.state === 'installing' || job.state === 'applying') {
    return t('runtimeConfig.localModelCenter.runtimeStageInstallingDetail', {
      defaultValue: 'Installing local image runtime. This step can take several minutes and may not report byte progress.',
    });
  }
  return state;
}

function runtimeDependencyIsCUDARuntime(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): boolean {
  return String(dependency?.dependencyFamily || job?.dependencyFamily || '').trim() === 'accelerator.cuda.runtime';
}

export type RuntimeDependencyTone = 'info' | 'warning' | 'danger';

// A runtime-managed dependency that is merely waiting for first-use setup or is
// actively materializing is a normal, expected step — not an alarm. Only the
// genuinely-stuck states (failed / cancelled / repair / unsupported) warrant a
// warning tone. Callers can escalate to `danger` themselves for hard errors.
export function runtimeDependencyTone(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): RuntimeDependencyTone {
  const state = runtimeDependencyCurrentState(dependency, job);
  if (
    isNimiRuntimeLocalEnvironmentDependencyJobFailedState(state)
    || isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(state)
    || isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(state)
    || isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(state)
  ) {
    return 'warning';
  }
  return 'info';
}

export function runtimeDependencyToneColor(tone: RuntimeDependencyTone): string {
  if (tone === 'danger') {
    return 'var(--nimi-status-danger)';
  }
  if (tone === 'warning') {
    return 'var(--nimi-status-warning)';
  }
  return 'var(--nimi-status-info)';
}

export function runtimeDependencyToneStyle(tone: RuntimeDependencyTone): CSSProperties {
  return { '--nimi-dep-tone': runtimeDependencyToneColor(tone) } as CSSProperties;
}

export function runtimeDependencyBannerTitle(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency | undefined,
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  t: TFunction,
): string {
  const state = runtimeDependencyCurrentState(dependency, job);
  if (isNimiRuntimeLocalEnvironmentDependencyJobActiveState(state)) {
    return runtimeDependencyStateStageLabel(state, t);
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobFailedState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupFailedTitle', {
      defaultValue: 'Local image runtime setup failed',
    });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupCancelledTitle', {
      defaultValue: 'Local image runtime setup cancelled',
    });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeRepairRequiredTitle', {
      defaultValue: 'Local image runtime repair required',
    });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeUnsupportedTitle', {
      defaultValue: 'Local image runtime unsupported',
    });
  }
  if (runtimeDependencyIsCUDARuntime(dependency, job)) {
    return t('runtimeConfig.localModelCenter.cudaRuntimeSetupTitle', {
      defaultValue: 'Optional local GPU acceleration',
    });
  }
  return t('runtimeConfig.localModelCenter.runtimeSetupTitle', {
    defaultValue: 'Enable local image generation',
  });
}

export function runtimeDependencyShortStatusLabel(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency | undefined,
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  t: TFunction,
): string {
  const state = runtimeDependencyCurrentState(dependency, job);
  if (isNimiRuntimeLocalEnvironmentDependencyJobActiveState(state)) {
    return runtimeDependencyStateStageLabel(state, t, true);
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobFailedState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupFailedBadge', { defaultValue: 'Runtime setup failed' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupCancelledBadge', { defaultValue: 'Runtime setup cancelled' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeRepairRequiredBadge', { defaultValue: 'Runtime repair required' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeUnsupportedBadge', { defaultValue: 'Runtime unsupported' });
  }
  return '';
}

export function runtimeDependencyStatusDetail(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency | undefined,
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  t: TFunction,
): string {
  const displayJob = runtimeDependencyJobForDisplay(dependency, job);
  if (displayJob && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(displayJob.state)) {
    return runtimeDependencyActiveDetail(displayJob, t);
  }
  if (displayJob && isNimiRuntimeLocalEnvironmentDependencyJobFailedState(displayJob.state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupFailedDetail', {
      defaultValue: 'Runtime stopped before the local image environment became ready. Technical reason is available in details.',
    });
  }
  if (displayJob && isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(displayJob.state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupCancelledDetail', {
      defaultValue: 'Runtime setup was cancelled before the local image environment became ready.',
    });
  }
  // Runtime-authored human `detail` is safe to surface; the machine `reasonCode`
  // / `state` never are — those stay in the collapsed technical section only.
  const humanDetail = String(dependency?.detail || '').trim();
  if (humanDetail) {
    return humanDetail;
  }
  const currentState = runtimeDependencyCurrentState(dependency, displayJob);
  if (isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState(currentState)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupRequiredDetail', {
      defaultValue: 'Before first use, Nimi downloads and installs the required local runtime components once. This runs in the background and only happens the first time.',
    });
  }
  return t('runtimeConfig.localModelCenter.runtimeDependencyNotReady', {
    defaultValue: 'Runtime-managed local environment dependencies are not ready.',
  });
}

function runtimeDependencyTechnicalDetails(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency | undefined,
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  t: TFunction,
): Array<[string, string]> {
  const displayJob = runtimeDependencyJobForDisplay(dependency, job);
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => {
    const text = String(value || '').trim();
    if (text) {
      rows.push([label, text]);
    }
  };
  add(t('runtimeConfig.localModelCenter.runtimeDependencyDetailState', { defaultValue: 'State' }), runtimeDependencyCurrentState(dependency, displayJob));
  add(t('runtimeConfig.localModelCenter.runtimeDependencyDetailJob', { defaultValue: 'Job' }), displayJob?.jobId);
  add(t('runtimeConfig.localModelCenter.runtimeDependencyDetailDependency', { defaultValue: 'Dependency' }), dependency ? `${dependency.dependencyFamily}/${dependency.dependencyId}` : displayJob ? `${displayJob.dependencyFamily}/${displayJob.dependencyId}` : '');
  add(t('runtimeConfig.localModelCenter.runtimeDependencyDetailScope', { defaultValue: 'Scope' }), displayJob?.consumerScope || dependency?.consumerScope);
  add(t('runtimeConfig.localModelCenter.runtimeDependencyDetailReason', { defaultValue: 'Reason' }), displayJob?.failureDetail || displayJob?.reasonCode || dependency?.reasonCode);
  return rows;
}

type RuntimeDependencyAttentionBannerProps = {
  assetBusy: boolean;
  canCancelRuntimeDependencyJob: boolean;
  canRepairRuntimeDependency: boolean;
  canRetryRuntimeDependencyJob: boolean;
  canStartRuntimeDependencySetup: boolean;
  confirmSetup: boolean;
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency;
  job?: NimiRuntimeLocalEnvironmentDependencyJob;
  onCancelJob: (jobId: string) => void;
  onCancelSetupConfirm: () => void;
  onConfirmSetup: () => void;
  onRepairDependency: () => void;
  onRequestSetupConfirm: () => void;
  onRetryJob: (jobId: string) => void;
};

export function RuntimeDependencyAttentionBanner(props: RuntimeDependencyAttentionBannerProps) {
  const i18n = useDesktopI18nResource().instance;
  const bindings = useDesktopRendererBindings();
  const nowMs = bindings.clock.now();
  const t = i18n.t.bind(i18n);
  const displayJob = runtimeDependencyJobForDisplay(props.dependency, props.job);
  const progressPercent = runtimeDependencyProgressPercent(displayJob);
  const progressSummary = runtimeDependencyProgressSummary(displayJob, t);
  const hasDeterminateProgress = Boolean(
    displayJob
    && isNimiRuntimeLocalEnvironmentDependencyJobTransferringState(displayJob.state)
    && Number(displayJob.bytesTotal) > 0,
  );
  const timingSummary = runtimeDependencyJobTimingSummary(displayJob, t, nowMs);
  const stale = runtimeDependencyJobIsStale(displayJob, nowMs);
  const technicalDetails = runtimeDependencyTechnicalDetails(props.dependency, displayJob, t);
  const tone = runtimeDependencyTone(props.dependency, displayJob);
  const toneStyle = runtimeDependencyToneStyle(tone);

  return (
    <div style={toneStyle} className="border-b border-[color-mix(in_srgb,var(--nimi-dep-tone)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-dep-tone)_8%,transparent)] px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--nimi-dep-tone)]">
            {runtimeDependencyBannerTitle(props.dependency, displayJob, t)}
          </p>
          <p className="mt-1 text-xs leading-5 text-[color-mix(in_srgb,var(--nimi-dep-tone)_82%,var(--nimi-text-secondary))]">
            {runtimeDependencyStatusDetail(props.dependency, displayJob, t)}
          </p>
          {displayJob ? (
            <>
              {hasDeterminateProgress ? (
                <div className="mt-3 max-w-xl">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--nimi-dep-tone)_16%,white)]">
                    <div
                      className="h-full rounded-full bg-[var(--nimi-dep-tone)] transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  {progressSummary ? (
                    <p className="mt-1 text-[10px] text-[color-mix(in_srgb,var(--nimi-dep-tone)_82%,var(--nimi-text-secondary))]">
                      {progressSummary}
                    </p>
                  ) : null}
                </div>
              ) : isNimiRuntimeLocalEnvironmentDependencyJobActiveState(displayJob.state) ? (
                <div className="mt-3 max-w-xl">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--nimi-dep-tone)_16%,white)]">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--nimi-dep-tone)]" />
                  </div>
                  {progressSummary ? (
                    <p className="mt-1 text-[10px] text-[color-mix(in_srgb,var(--nimi-dep-tone)_82%,var(--nimi-text-secondary))]">
                      {progressSummary}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {timingSummary ? (
                <p className="mt-2 text-[10px] font-medium text-[color-mix(in_srgb,var(--nimi-dep-tone)_82%,var(--nimi-text-secondary))]">
                  {timingSummary}
                </p>
              ) : null}
              {stale ? (
                <p className="mt-1 text-[10px] font-medium text-[var(--nimi-status-warning)]">
                  {t('runtimeConfig.localModelCenter.runtimeDependencyNoProgress', {
                    defaultValue: 'No progress has been reported for more than 5 minutes. The task may still be installing, but details should be checked.',
                  })}
                </p>
              ) : null}
            </>
          ) : null}
          {technicalDetails.length > 0 ? (
            <details className="mt-3 text-[10px] text-[color-mix(in_srgb,var(--nimi-text-secondary)_86%,transparent)]">
              <summary className="cursor-pointer font-medium">
                {t('runtimeConfig.localModelCenter.runtimeDependencyDetailsToggle', { defaultValue: 'Runtime details' })}
              </summary>
              <dl className="mt-2 grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
                {technicalDetails.map(([label, value]) => (
                  <div key={`${label}:${value}`} className="contents">
                    <dt className="font-medium text-[color-mix(in_srgb,var(--nimi-text-secondary)_78%,transparent)]">{label}</dt>
                    <dd className="min-w-0 break-all font-mono text-[color-mix(in_srgb,var(--nimi-text-primary)_72%,transparent)]">{value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {props.canCancelRuntimeDependencyJob && displayJob ? (
            <button
              type="button"
              onClick={() => props.onCancelJob(displayJob.jobId)}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-dep-tone)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-dep-tone)] hover:bg-[color-mix(in_srgb,var(--nimi-dep-tone)_10%,transparent)] disabled:opacity-50"
            >
              {t('Common.cancel', { defaultValue: 'Cancel' })}
            </button>
          ) : null}
          {props.canRetryRuntimeDependencyJob && displayJob ? (
            <button
              type="button"
              onClick={() => props.onRetryJob(displayJob.jobId)}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-dep-tone)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-dep-tone)] hover:bg-[color-mix(in_srgb,var(--nimi-dep-tone)_10%,transparent)] disabled:opacity-50"
            >
              {t('runtimeConfig.localModelCenter.retry', { defaultValue: 'Retry' })}
            </button>
          ) : null}
          {props.canRepairRuntimeDependency ? (
            <button
              type="button"
              onClick={props.onRepairDependency}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-dep-tone)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-dep-tone)] hover:bg-[color-mix(in_srgb,var(--nimi-dep-tone)_10%,transparent)] disabled:opacity-50"
            >
              {t('runtimeConfig.localModelCenter.repair', { defaultValue: 'Repair' })}
            </button>
          ) : null}
          {props.canStartRuntimeDependencySetup && props.confirmSetup ? (
            <>
              <button
                type="button"
                onClick={props.onConfirmSetup}
                disabled={props.assetBusy}
                className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-dep-tone)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-dep-tone)] hover:bg-[color-mix(in_srgb,var(--nimi-dep-tone)_10%,transparent)] disabled:opacity-50"
              >
                {t('runtimeConfig.localModelCenter.confirmSetup', { defaultValue: 'Confirm' })}
              </button>
              <button
                type="button"
                onClick={props.onCancelSetupConfirm}
                className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
              >
                {t('Common.cancel', { defaultValue: 'Cancel' })}
              </button>
            </>
          ) : props.canStartRuntimeDependencySetup ? (
            <button
              type="button"
              onClick={props.onRequestSetupConfirm}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-dep-tone)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-dep-tone)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-dep-tone)_10%,transparent)] disabled:opacity-50"
            >
              {t('runtimeConfig.localModelCenter.setupDependency', { defaultValue: 'Download & Enable' })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
