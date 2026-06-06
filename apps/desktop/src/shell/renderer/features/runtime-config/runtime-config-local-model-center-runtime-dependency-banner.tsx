import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState,
  isNimiRuntimeLocalEnvironmentDependencyUnsupportedState,
} from '@nimiplatform/sdk/runtime';
import { i18n } from '@renderer/i18n';

function runtimeDependencyCurrentState(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): string {
  return String(job?.state || dependency?.state || '').trim();
}

export function runtimeDependencyBannerTitle(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): string {
  const state = runtimeDependencyCurrentState(dependency, job);
  if (isNimiRuntimeLocalEnvironmentDependencyJobActiveState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeSetupInProgressTitle', {
      defaultValue: 'Local image runtime setup in progress',
    });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobFailedState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeSetupFailedTitle', {
      defaultValue: 'Local image runtime setup failed',
    });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeSetupCancelledTitle', {
      defaultValue: 'Local image runtime setup cancelled',
    });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeRepairRequiredTitle', {
      defaultValue: 'Local image runtime repair required',
    });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeUnsupportedTitle', {
      defaultValue: 'Local image runtime unsupported',
    });
  }
  return i18n.t('runtimeConfig.localModelCenter.cudaRuntimeSetupTitle', {
    defaultValue: 'Local image runtime setup',
  });
}

export function runtimeDependencyStatusDetail(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): string {
  const jobDetail = String(job?.failureDetail || '').trim();
  if (jobDetail) {
    return jobDetail;
  }
  const dependencyDetail = String(dependency?.detail || dependency?.reasonCode || dependency?.state || '').trim();
  if (dependencyDetail) {
    return dependencyDetail;
  }
  return i18n.t('runtimeConfig.localModelCenter.runtimeDependencyNotReady', {
    defaultValue: 'Runtime-managed local environment dependencies are not ready.',
  });
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
  return (
    <div className="border-b border-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,transparent)] px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--nimi-status-warning)]">
            {runtimeDependencyBannerTitle(props.dependency, props.job)}
          </p>
          <p className="mt-1 text-xs leading-5 text-[color-mix(in_srgb,var(--nimi-status-warning)_82%,var(--nimi-text-secondary))]">
            {runtimeDependencyStatusDetail(props.dependency, props.job)}
          </p>
          {props.job ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color-mix(in_srgb,var(--nimi-status-warning)_82%,var(--nimi-text-secondary))]">
              <span className="font-medium">
                {i18n.t('runtimeConfig.localModelCenter.runtimeDependencyJobState', {
                  defaultValue: 'Runtime job: {{state}}',
                  state: props.job.state,
                })}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {props.canCancelRuntimeDependencyJob && props.job ? (
            <button
              type="button"
              onClick={() => props.onCancelJob(props.job!.jobId)}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] disabled:opacity-50"
            >
              {i18n.t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
            </button>
          ) : null}
          {props.canRetryRuntimeDependencyJob && props.job ? (
            <button
              type="button"
              onClick={() => props.onRetryJob(props.job!.jobId)}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] disabled:opacity-50"
            >
              {i18n.t('runtimeConfig.localModelCenter.retry', { defaultValue: 'Retry' })}
            </button>
          ) : null}
          {props.canRepairRuntimeDependency ? (
            <button
              type="button"
              onClick={props.onRepairDependency}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] disabled:opacity-50"
            >
              {i18n.t('runtimeConfig.localModelCenter.repair', { defaultValue: 'Repair' })}
            </button>
          ) : null}
          {props.canStartRuntimeDependencySetup && props.confirmSetup ? (
            <>
              <button
                type="button"
                onClick={props.onConfirmSetup}
                disabled={props.assetBusy}
                className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] disabled:opacity-50"
              >
                {i18n.t('runtimeConfig.localModelCenter.confirmSetup', { defaultValue: 'Confirm' })}
              </button>
              <button
                type="button"
                onClick={props.onCancelSetupConfirm}
                className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
              >
                {i18n.t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
              </button>
            </>
          ) : props.canStartRuntimeDependencySetup ? (
            <button
              type="button"
              onClick={props.onRequestSetupConfirm}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] disabled:opacity-50"
            >
              {i18n.t('runtimeConfig.localModelCenter.setupDependency', { defaultValue: 'Set Up' })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
