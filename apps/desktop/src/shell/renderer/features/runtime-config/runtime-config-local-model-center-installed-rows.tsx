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
import { i18n } from '@renderer/i18n';
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
  type RuntimeDependencyTone,
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

export function assetNeedsAttachedEndpointRepair(asset: NimiRuntimeLocalAssetRecord): boolean {
  if (asset.engineRuntimeMode !== 'attached-endpoint') {
    return false;
  }
  return String(asset.reasonCode || '').trim() === 'AI_LOCAL_ENDPOINT_REQUIRED';
}

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
  asset: NimiRuntimeLocalAssetRecord,
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): boolean {
  const detail = String(asset.healthDetail || '').trim().toLowerCase();
  return (
    asset.kind === 'image'
    && (
      (
        asset.status === 'unhealthy'
        && detail.includes('local environment activation blocked')
      )
      || runtimeDependencyRequiresAttention(dependency, job)
    )
  );
}

function runtimeDependencyDetail(
  asset: NimiRuntimeLocalAssetRecord,
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): string {
  if (runtimeDependencyRequiresAttention(dependency, job)) {
    return runtimeDependencyStatusDetail(dependency, job);
  }
  const healthDetail = String(asset.healthDetail || '').trim();
  if (healthDetail) {
    return healthDetail;
  }
  if (!dependency) {
    return '';
  }
  // Only Runtime-authored human `detail` is user-facing; `reasonCode` / `state`
  // are machine identifiers and must never render as copy.
  return String(dependency.detail || '').trim();
}

function assetHasHardRuntimeDependencyError(
  asset: NimiRuntimeLocalAssetRecord,
): boolean {
  const detail = String(asset.healthDetail || '').trim().toLowerCase();
  return asset.kind === 'image' && asset.status === 'unhealthy' && detail.includes('local environment activation blocked');
}

function runtimeDependencyRowTone(
  asset: NimiRuntimeLocalAssetRecord,
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): RuntimeDependencyTone {
  if (assetHasHardRuntimeDependencyError(asset)) {
    return 'danger';
  }
  return runtimeDependencyTone(dependency, job);
}

function runtimeDependencyReadinessLabel(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): string {
  const state = runtimeDependencyCurrentState(dependency, job);
  if (isNimiRuntimeLocalEnvironmentDependencyJobActiveState(state)) {
    return runtimeDependencyShortStatusLabel(dependency, job)
      || i18n.t('runtimeConfig.localModelCenter.runtimeSetupRunningBadge', { defaultValue: 'Runtime setup running' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobFailedState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeSetupFailedBadge', { defaultValue: 'Runtime setup failed' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeSetupCancelledBadge', { defaultValue: 'Runtime setup cancelled' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeRepairRequiredBadge', { defaultValue: 'Runtime repair required' });
  }
  if (isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeUnsupportedBadge', { defaultValue: 'Runtime unsupported' });
  }
  if (dependency?.confirmationRequired && isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState(state)) {
    return i18n.t('runtimeConfig.localModelCenter.runtimeSetupRequiredBadge', { defaultValue: 'Setup needed' });
  }
  return i18n.t('runtimeConfig.localModelCenter.runtimeNotReadyBadge', { defaultValue: 'Runtime not ready' });
}

function assetStatusLabel(asset: NimiRuntimeLocalAssetRecord): string {
  if (asset.status === 'installed') {
    return i18n.t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' });
  }
  return asset.status;
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
  repairAssetId: string;
  repairEndpoint: string;
  runtimeDependency?: NimiRuntimeLocalEnvironmentPlanDependency;
  runtimeDependencyJob?: NimiRuntimeLocalEnvironmentDependencyJob;
  onCancelRemove: () => void;
  onCancelRepair: () => void;
  onConfirmRemove: (localAssetId: string) => void;
  onRepairAsset: (localAssetId: string, endpoint: string) => void;
  onRepairEndpointChange: (value: string) => void;
  onRequestRemove: (localAssetId: string) => void;
  onRequestRepair: (localAssetId: string) => void;
  onSetupRuntimeDependency: () => void;
  onRescanAsset: (localAssetId: string) => void;
};

export function RunnableInstalledAssetRow(props: RunnableInstalledAssetRowProps) {
  const needsRepair = assetNeedsAttachedEndpointRepair(props.asset);
  const hasRuntimeDependencyWarning = assetHasRuntimeDependencyWarning(
    props.asset,
    props.runtimeDependency,
    props.runtimeDependencyJob,
  );
  const dependencyDetail = runtimeDependencyDetail(props.asset, props.runtimeDependency, props.runtimeDependencyJob);
  const statusLabel = hasRuntimeDependencyWarning
    ? runtimeDependencyReadinessLabel(props.runtimeDependency, props.runtimeDependencyJob)
    : assetStatusLabel(props.asset);
  const rowTone = runtimeDependencyRowTone(props.asset, props.runtimeDependency, props.runtimeDependencyJob);
  const rowToneStyle = runtimeDependencyToneStyle(rowTone);
  const isRepairing = props.repairAssetId === props.asset.localAssetId;
  const supportsRescan = assetSupportsBundleRescan(props.asset);
  const unhealthyReasonSummary = props.asset.status === 'unhealthy'
    ? localizedAssetUnhealthyReason(props.asset.reasonCode)
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
              {recommendationSummary(props.asset.recommendation)}
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
              {unhealthyReasonSummary || i18n.t('runtimeConfig.localModelCenter.assetUnhealthyGeneric', {
                defaultValue: 'This model is currently unavailable. Try re-scanning its bundle, or remove and re-import it.',
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
              {i18n.t('runtimeConfig.localModelCenter.setupDependency', { defaultValue: 'Set Up' })}
            </button>
          ) : null}
          {needsRepair ? (
            <button
              type="button"
              onClick={() => props.onRequestRepair(props.asset.localAssetId)}
              disabled={props.assetBusy}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--nimi-status-warning)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] disabled:opacity-50"
            >
              {i18n.t('runtimeConfig.localModelCenter.repair', { defaultValue: 'Repair' })}
            </button>
          ) : null}
          {supportsRescan ? (
            <button
              type="button"
              onClick={() => props.onRescanAsset(props.asset.localAssetId)}
              disabled={props.assetBusy}
              className="rounded-lg border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
            >
              {i18n.t('runtimeConfig.localModelCenter.rescanBundle', { defaultValue: 'Re-scan Bundle' })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => props.onRequestRemove(props.asset.localAssetId)}
            disabled={props.assetBusy || props.confirmRemoveAssetId === props.asset.localAssetId}
            className="rounded-lg p-1.5 text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
            title={i18n.t('runtimeConfig.localModelCenter.remove', { defaultValue: 'Remove' })}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {isRepairing ? (
        <div className="mt-2 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] px-4 py-3">
          <p className="text-xs text-[var(--nimi-status-warning)]">
            {String(props.asset.healthDetail || '').trim() || i18n.t('runtimeConfig.localModelCenter.repairAttachedEndpointHint', {
              defaultValue: 'This asset must be rebound to an external attached endpoint on the current host.',
            })}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={props.repairEndpoint}
              onChange={(event) => props.onRepairEndpointChange(event.target.value)}
              placeholder={i18n.t('runtimeConfig.localModelCenter.repairEndpointPlaceholder', { defaultValue: 'http://host:port/v1' })}
              className="h-9 min-w-0 flex-1 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-mint-100"
            />
            <button
              type="button"
              onClick={() => {
                void Promise.resolve(props.onRepairAsset(props.asset.localAssetId, props.repairEndpoint));
              }}
              disabled={props.assetBusy || !String(props.repairEndpoint || '').trim()}
              className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] disabled:opacity-50"
            >
              {i18n.t('runtimeConfig.localModelCenter.confirmRepair', { defaultValue: 'Apply' })}
            </button>
            <button
              type="button"
              onClick={props.onCancelRepair}
              className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
            >
              {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </div>
      ) : null}
      {props.confirmRemoveAssetId === props.asset.localAssetId ? (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-2.5">
          <p className="flex-1 text-xs text-[var(--nimi-status-danger)]">
            {i18n.t('runtimeConfig.localModelCenter.confirmRemoveAsset', {
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
            {i18n.t('runtimeConfig.localModelCenter.confirm', { defaultValue: 'Confirm' })}
          </button>
          <button
            type="button"
            onClick={props.onCancelRemove}
            className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
          >
            {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
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
  const unhealthyReasonSummary = props.asset.status === 'unhealthy'
    ? localizedAssetUnhealthyReason(props.asset.reasonCode)
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
        {props.asset.status === 'unhealthy' && String(props.asset.healthDetail || '').trim() ? (
          <p className="mt-1 line-clamp-3 text-[11px] text-[var(--nimi-status-danger)]">
            {String(props.asset.healthDetail || '').trim()}
          </p>
        ) : null}
        {props.asset.status === 'unhealthy' && String(props.asset.reasonCode || '').trim() ? (
          <p
            className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-status-danger)]"
            title={String(props.asset.reasonCode || '').trim()}
          >
            {unhealthyReasonSummary || i18n.t('runtimeConfig.localModelCenter.assetUnhealthyGeneric', {
              defaultValue: 'This model is currently unavailable. Try re-scanning its bundle, or remove and re-import it.',
            })}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[10px] ${
          props.asset.status === 'active' ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : props.asset.status === 'unhealthy' ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]'
        }`}>
          {props.asset.status}
        </span>
        <button
          type="button"
          onClick={() => props.onRequestRemove(props.asset.localAssetId)}
          disabled={props.assetBusy || props.confirmRemoveAssetId === props.asset.localAssetId}
          className="rounded-lg p-1.5 text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
          title={i18n.t('runtimeConfig.localModelCenter.removeAsset', { defaultValue: 'Remove asset' })}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
      {props.confirmRemoveAssetId === props.asset.localAssetId ? (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-2.5">
          <p className="flex-1 text-xs text-[var(--nimi-status-danger)]">
            {i18n.t('runtimeConfig.localModelCenter.confirmRemoveAsset', {
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
            {i18n.t('runtimeConfig.localModelCenter.confirm', { defaultValue: 'Confirm' })}
          </button>
          <button
            type="button"
            onClick={props.onCancelRemove}
            className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
          >
            {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
