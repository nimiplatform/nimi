import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { TFunction } from 'i18next';
import type {
  NimiRuntimeLocalAssetRecord,
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  isNimiRuntimeLocalEnvironmentDependencyJobRetryableState,
  isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState,
  isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState,
  isNimiRuntimeLocalEnvironmentDependencyUnsupportedState,
} from '@nimiplatform/sdk/runtime';

import { localizedAssetUnhealthyReason } from './runtime-config-reason-messages';
import {
  formatAssetKindLabel,
  ModelIcon,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
  TrashIcon,
} from './runtime-config-local-model-center-helpers';
import {
  runtimeDependencyShortStatusLabel,
  runtimeDependencyStatusDetail,
  runtimeDependencyTone,
  runtimeDependencyToneStyle,
} from './runtime-config-local-model-center-runtime-dependency-banner';
import {
  runtimeDependencyCurrentState,
  runtimeDependencyJobShouldSurface,
  runtimeDependencyRequiresAttention,
} from './runtime-config-local-model-center-runtime-dependency-state';

export {
  RuntimeDependencyAttentionBanner,
  runtimeDependencyBannerTitle,
  runtimeDependencyStatusDetail,
} from './runtime-config-local-model-center-runtime-dependency-banner';
export { runtimeDependencyRequiresAttention } from './runtime-config-local-model-center-runtime-dependency-state';

export function assetSupportsBundleRescan(asset: NimiRuntimeLocalAssetRecord): boolean {
  return String(asset.source.repo || '').trim().toLowerCase().startsWith('file://');
}

function runtimeDependencyJobUpdatedAtMs(job: NimiRuntimeLocalEnvironmentDependencyJob): number {
  const updatedAtMs = Date.parse(String(job.updatedAt || job.createdAt || ''));
  return Number.isFinite(updatedAtMs) ? updatedAtMs : 0;
}

export function latestRuntimeDependencyJob(
  jobs: NimiRuntimeLocalEnvironmentDependencyJob[],
): NimiRuntimeLocalEnvironmentDependencyJob | undefined {
  return jobs.slice().sort((left, right) => runtimeDependencyJobUpdatedAtMs(right) - runtimeDependencyJobUpdatedAtMs(left))[0];
}

export function runtimeDependencyJobMatchesDependency(
  job: NimiRuntimeLocalEnvironmentDependencyJob,
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
): boolean {
  if (!dependency?.environmentKey) {
    return false;
  }
  return (
    job.environmentKey === dependency.environmentKey
    && job.dependencyFamily === dependency.dependencyFamily
    && job.dependencyId === dependency.dependencyId
    && job.consumerScope === dependency.consumerScope
  );
}

export function runtimeDependencySetupAllowed(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): boolean {
  if (!dependency || !dependency.confirmationRequired) {
    return false;
  }
  if (job && (
    isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state)
    || isNimiRuntimeLocalEnvironmentDependencyJobRetryableState(job.state)
  )) {
    return false;
  }
  return isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState(dependency.state);
}

export function runtimeDependencyRepairAllowed(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): boolean {
  const displayJob = runtimeDependencyJobShouldSurface(dependency, job) ? job : undefined;
  if (!(dependency?.selectedSourceRecordId || displayJob?.selectedSourceRecordId)) {
    return false;
  }
  return Boolean(
    (dependency && isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(dependency.state))
    || (displayJob && isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(displayJob.state)),
  );
}

function assetHasRuntimeDependencyWarning(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): boolean {
  return runtimeDependencyRequiresAttention(dependency, job);
}

function runtimeDependencyDetail(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency | undefined,
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  t: TFunction,
): string {
  if (runtimeDependencyRequiresAttention(dependency, job)) {
    return runtimeDependencyStatusDetail(dependency, job, t);
  }
  if (!dependency) {
    return '';
  }
  // Only Runtime-authored human `detail` is user-facing; `reasonCode` / `state`
  // are machine identifiers and must never render as copy.
  return String(dependency.detail || '').trim();
}

function runtimeDependencyStatusLabel(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency | undefined,
  job: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
  t: TFunction,
): string {
  const state = runtimeDependencyCurrentState(dependency, job);
  if (isNimiRuntimeLocalEnvironmentDependencyJobActiveState(state)) {
    return runtimeDependencyShortStatusLabel(dependency, job, t)
      || t('runtimeConfig.localModelCenter.runtimeSetupRunningBadge', { defaultValue: 'Runtime setup running' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobFailedState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupFailedBadge', { defaultValue: 'Runtime setup failed' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupCancelledBadge', { defaultValue: 'Runtime setup cancelled' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupActionRequiredBadge', { defaultValue: 'Runtime setup action required' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeUnsupportedBadge', { defaultValue: 'Runtime unsupported' });
  }
  if (dependency?.confirmationRequired && isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState(state)) {
    return t('runtimeConfig.localModelCenter.runtimeSetupRequiredBadge', { defaultValue: 'Setup needed' });
  }
  return t('runtimeConfig.localModelCenter.runtimeSetupIncompleteBadge', { defaultValue: 'Runtime setup incomplete' });
}

function assetStatusLabel(asset: NimiRuntimeLocalAssetRecord, t: TFunction): string {
  if (asset.status === 'unhealthy') {
    return t('runtimeConfig.localModelCenter.assetIssue', { defaultValue: 'Asset issue' });
  }
  return t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' });
}

function assetStatusBadgeClass(asset: NimiRuntimeLocalAssetRecord): string {
  if (asset.status === 'active') {
    return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]';
  }
  if (asset.status === 'unhealthy') {
    return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]';
  }
  return 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]';
}

type RunnableInstalledAssetRowProps = {
  asset: NimiRuntimeLocalAssetRecord;
  assetBusy: boolean;
  canStartRuntimeDependencySetup: boolean;
  confirmRemoveAssetId: string;
  runtimeDependency?: NimiRuntimeLocalEnvironmentPlanDependency;
  runtimeDependencyJob?: NimiRuntimeLocalEnvironmentDependencyJob;
  onCancelRemove: () => void;
  onConfirmRemove: (localAssetId: string) => void;
  onRequestRemove: (localAssetId: string) => void;
  onSetupRuntimeDependency: () => void;
  onRescanAsset: (localAssetId: string) => void;
};

export function RunnableInstalledAssetRow(props: RunnableInstalledAssetRowProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const hasRuntimeDependencyWarning = assetHasRuntimeDependencyWarning(
    props.runtimeDependency,
    props.runtimeDependencyJob,
  );
  const dependencyDetail = runtimeDependencyDetail(
    props.runtimeDependency,
    props.runtimeDependencyJob,
    t,
  );
  const statusLabel = hasRuntimeDependencyWarning
    ? runtimeDependencyStatusLabel(props.runtimeDependency, props.runtimeDependencyJob, t)
    : assetStatusLabel(props.asset, t);
  const rowToneStyle = runtimeDependencyToneStyle(
    runtimeDependencyTone(props.runtimeDependency, props.runtimeDependencyJob),
  );
  const supportsRescan = assetSupportsBundleRescan(props.asset);
  const unhealthyReasonSummary = props.asset.status === 'unhealthy'
    ? localizedAssetUnhealthyReason(props.asset.reasonCode, i18n.t)
    : '';

  return (
    <div style={rowToneStyle} className="px-5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)]">
      <div className="flex items-center gap-3">
        <ModelIcon engine={props.asset.engine} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{props.asset.assetId}</span>
            <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">{props.asset.engine}</span>
            <span className="rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-action-primary-bg)]">
              {formatAssetKindLabel(props.asset.kind)}
            </span>
            {props.asset.recommendation ? (
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${recommendationTierClass(props.asset.recommendation.tier)}`}>
                {recommendationTierLabel(props.asset.recommendation.tier)}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-[var(--nimi-text-muted)]">{props.asset.localAssetId}</p>
          {props.asset.recommendation ? (
            <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-text-muted)]">
              {recommendationSummary(props.asset.recommendation, t)}
            </p>
          ) : null}
          {(props.asset.status === 'unhealthy' || hasRuntimeDependencyWarning) && dependencyDetail ? (
            <p className={`mt-1 line-clamp-3 text-[11px] ${
              hasRuntimeDependencyWarning
                ? 'text-[var(--nimi-dep-tone)]'
                : 'text-[var(--nimi-status-danger)]'
            }`}>
              {dependencyDetail}
            </p>
          ) : null}
          {props.asset.status === 'unhealthy' && String(props.asset.reasonCode || '').trim() ? (
            <p
              className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-status-danger)]"
              title={String(props.asset.reasonCode || '').trim()}
            >
              {unhealthyReasonSummary || t('runtimeConfig.localModelCenter.assetIssueGeneric', {
                defaultValue: 'Runtime reported an issue for this local asset. Re-scan its bundle, or remove and re-import it.',
              })}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1">
            {(props.asset.capabilities || []).slice(0, 3).map((capability) => (
              <span key={capability} className="rounded border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-action-primary-bg)]">{capability}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] ${
            hasRuntimeDependencyWarning
              ? 'bg-[color-mix(in_srgb,var(--nimi-dep-tone)_16%,transparent)] text-[var(--nimi-dep-tone)]'
              : assetStatusBadgeClass(props.asset)
          }`}>
            {statusLabel}
          </span>
          {props.canStartRuntimeDependencySetup ? (
            <button
              type="button"
              onClick={props.onSetupRuntimeDependency}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-dep-tone)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-dep-tone)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--nimi-dep-tone)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-dep-tone)_16%,transparent)] disabled:opacity-50"
            >
              {t('runtimeConfig.localModelCenter.setupDependency', { defaultValue: 'Set Up' })}
            </button>
          ) : null}
          {supportsRescan ? (
            <button
              type="button"
              onClick={() => props.onRescanAsset(props.asset.localAssetId)}
              disabled={props.assetBusy}
              className="rounded-lg border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
            >
              {t('runtimeConfig.localModelCenter.rescanBundle', { defaultValue: 'Re-scan Bundle' })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => props.onRequestRemove(props.asset.localAssetId)}
            disabled={props.assetBusy || props.confirmRemoveAssetId === props.asset.localAssetId}
            className="rounded-lg p-1.5 text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
            title={t('runtimeConfig.localModelCenter.remove', { defaultValue: 'Remove' })}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {props.confirmRemoveAssetId === props.asset.localAssetId ? (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-2.5">
          <p className="flex-1 text-xs text-[var(--nimi-status-danger)]">
            {t('runtimeConfig.localModelCenter.confirmRemoveAsset', {
              defaultValue: 'Remove "{{name}}"? Asset files will be permanently deleted.',
              name: props.asset.assetId,
            })}
          </p>
          <button
            type="button"
            onClick={() => props.onConfirmRemove(props.asset.localAssetId)}
            disabled={props.assetBusy}
            className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] disabled:opacity-50"
          >
            {t('runtimeConfig.localModelCenter.confirm', { defaultValue: 'Confirm' })}
          </button>
          <button
            type="button"
            onClick={props.onCancelRemove}
            className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
          >
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
        </div>
      ) : null}
    </div>
  );
}

type DependencyInstalledAssetRowProps = {
  asset: NimiRuntimeLocalAssetRecord;
  assetBusy: boolean;
  confirmRemoveAssetId: string;
  onCancelRemove: () => void;
  onConfirmRemove: (localAssetId: string) => void;
  onRequestRemove: (localAssetId: string) => void;
};

export function DependencyInstalledAssetRow(props: DependencyInstalledAssetRowProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const unhealthyReasonSummary = props.asset.status === 'unhealthy'
    ? localizedAssetUnhealthyReason(props.asset.reasonCode, i18n.t)
    : '';

  return (
    <div className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[11px] font-semibold text-[var(--nimi-text-secondary)]">
        {formatAssetKindLabel(props.asset.kind).slice(0, 3).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{props.asset.assetId}</span>
          <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">
            {formatAssetKindLabel(props.asset.kind)}
          </span>
          <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">{props.asset.engine}</span>
        </div>
        <p className="truncate text-xs text-[var(--nimi-text-muted)]">{props.asset.localAssetId}</p>
        <p className="truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{props.asset.entry}</p>
        {props.asset.status === 'unhealthy' && String(props.asset.reasonCode || '').trim() ? (
          <p
            className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-status-danger)]"
            title={String(props.asset.reasonCode || '').trim()}
          >
            {unhealthyReasonSummary || t('runtimeConfig.localModelCenter.assetIssueGeneric', {
              defaultValue: 'Runtime reported an issue for this local asset. Re-scan its bundle, or remove and re-import it.',
            })}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[10px] ${
          props.asset.status === 'active' ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : props.asset.status === 'unhealthy' ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]'
        }`}>
          {assetStatusLabel(props.asset, t)}
        </span>
        <button
          type="button"
          onClick={() => props.onRequestRemove(props.asset.localAssetId)}
          disabled={props.assetBusy || props.confirmRemoveAssetId === props.asset.localAssetId}
          className="rounded-lg p-1.5 text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
          title={t('runtimeConfig.localModelCenter.removeAsset', { defaultValue: 'Remove asset' })}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
      {props.confirmRemoveAssetId === props.asset.localAssetId ? (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-2.5">
          <p className="flex-1 text-xs text-[var(--nimi-status-danger)]">
            {t('runtimeConfig.localModelCenter.confirmRemoveAsset', {
              defaultValue: 'Remove "{{name}}"? Asset files will be permanently deleted.',
              name: props.asset.assetId,
            })}
          </p>
          <button
            type="button"
            onClick={() => props.onConfirmRemove(props.asset.localAssetId)}
            disabled={props.assetBusy}
            className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] disabled:opacity-50"
          >
            {t('runtimeConfig.localModelCenter.confirm', { defaultValue: 'Confirm' })}
          </button>
          <button
            type="button"
            onClick={props.onCancelRemove}
            className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
          >
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
