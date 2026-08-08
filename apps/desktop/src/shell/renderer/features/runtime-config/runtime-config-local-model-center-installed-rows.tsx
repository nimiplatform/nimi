import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { TFunction } from 'i18next';
import type { NimiRuntimeLocalAssetRecord } from '@nimiplatform/sdk/runtime';

import { localizedAssetUnhealthyReason } from './runtime-config-reason-messages';
import {
  assetDisplayName,
  formatAssetKindLabel,
  installedAssetMetaLine,
  localizedAssetCapabilityLabels,
  localizedAssetKindLabel,
  ModelIcon,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
  TrashIcon,
} from './runtime-config-local-model-center-helpers';
export function assetSupportsBundleRescan(asset: NimiRuntimeLocalAssetRecord): boolean {
  return String(asset.source.repo || '').trim().toLowerCase().startsWith('file://');
}

function assetStatusLabel(asset: NimiRuntimeLocalAssetRecord, t: TFunction): string {
  if (asset.status === 'unhealthy') {
    return t('runtimeConfig.localModelCenter.assetIssue', { defaultValue: 'Asset issue' });
  }
  return t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' });
}

function assetStatusBadgeClass(asset: NimiRuntimeLocalAssetRecord): string {
  // Soft status tokens, consistent with kit StatusBadge tone surfaces.
  if (asset.status === 'active') {
    return 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]';
  }
  if (asset.status === 'unhealthy') {
    return 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]';
  }
  return 'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]';
}

type RunnableInstalledAssetRowProps = {
  asset: NimiRuntimeLocalAssetRecord;
  assetBusy: boolean;
  confirmRemoveAssetId: string;
  onCancelRemove: () => void;
  onConfirmRemove: (localAssetId: string) => void;
  onRequestRemove: (localAssetId: string) => void;
  onRescanAsset: (localAssetId: string) => void;
};

export function RunnableInstalledAssetRow(props: RunnableInstalledAssetRowProps) {
  const i18nResource = useDesktopI18nResource();
  const i18n = i18nResource.instance;
  const t = i18n.t.bind(i18n);
  const statusLabel = assetStatusLabel(props.asset, t);
  const supportsRescan = assetSupportsBundleRescan(props.asset);
  const unhealthyReasonSummary = props.asset.status === 'unhealthy'
    ? localizedAssetUnhealthyReason(props.asset.reasonCode, i18n.t)
    : '';
  const displayName = assetDisplayName(props.asset);
  const kindLabel = localizedAssetKindLabel(props.asset.kind, t);
  const capabilityLabels = localizedAssetCapabilityLabels(props.asset.capabilities, t);
  const metaLine = installedAssetMetaLine(props.asset, i18nResource);

  return (
    <div className="px-5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]">
      <div className="flex items-center gap-3">
        <ModelIcon engine={props.asset.engine} badge={kindLabel} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="truncate text-sm font-medium text-[var(--nimi-text-primary)]"
              title={props.asset.assetId}
            >
              {displayName}
            </span>
            <span className="rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-action-primary-bg)]">
              {kindLabel}
            </span>
            {props.asset.recommendation ? (
              <span className={`rounded px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] ${recommendationTierClass(props.asset.recommendation.tier)}`}>
                {recommendationTierLabel(props.asset.recommendation.tier)}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-[var(--nimi-text-muted)]">{metaLine}</p>
          {props.asset.recommendation ? (
            <p className="mt-1 line-clamp-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
              {recommendationSummary(props.asset.recommendation, t)}
            </p>
          ) : null}
          {props.asset.status === 'unhealthy' && String(props.asset.reasonCode || '').trim() ? (
            <p
              className="mt-1 line-clamp-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-danger)]"
              title={String(props.asset.reasonCode || '').trim()}
            >
              {unhealthyReasonSummary || t('runtimeConfig.localModelCenter.assetIssueGeneric', {
                defaultValue: 'Runtime reported an issue for this local asset. Re-check its files, or remove and re-import it.',
              })}
            </p>
          ) : null}
          {capabilityLabels.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {capabilityLabels.map((label) => (
                <span key={label} className="rounded border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-action-primary-bg)]">{label}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] ${assetStatusBadgeClass(props.asset)}`}>
            {statusLabel}
          </span>
          {supportsRescan ? (
            <button
              type="button"
              onClick={() => props.onRescanAsset(props.asset.localAssetId)}
              disabled={props.assetBusy}
              className="rounded-lg border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
            >
              {t('runtimeConfig.localModelCenter.rescanBundle', { defaultValue: 'Re-check files' })}
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
              name: displayName,
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
  const displayName = assetDisplayName(props.asset);
  const kindLabel = localizedAssetKindLabel(props.asset.kind, t);
  const fileLabel = String(props.asset.sourceFileName || '').trim() || String(props.asset.entry || '').trim();

  return (
    <div className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-text-secondary)]">
        {formatAssetKindLabel(props.asset.kind).slice(0, 3).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-sm font-medium text-[var(--nimi-text-primary)]"
            title={props.asset.assetId}
          >
            {displayName}
          </span>
          <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
            {kindLabel}
          </span>
        </div>
        {fileLabel && fileLabel !== displayName ? (
          <p className="truncate text-xs text-[var(--nimi-text-muted)]">{fileLabel}</p>
        ) : null}
        {props.asset.status === 'unhealthy' && String(props.asset.reasonCode || '').trim() ? (
          <p
            className="mt-1 line-clamp-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-danger)]"
            title={String(props.asset.reasonCode || '').trim()}
          >
            {unhealthyReasonSummary || t('runtimeConfig.localModelCenter.assetIssueGeneric', {
              defaultValue: 'Runtime reported an issue for this local asset. Re-check its files, or remove and re-import it.',
            })}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] ${assetStatusBadgeClass(props.asset)}`}>
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
              name: displayName,
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
