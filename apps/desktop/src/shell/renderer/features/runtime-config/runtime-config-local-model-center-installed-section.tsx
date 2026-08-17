import { useState } from 'react';
import type { NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { formatBytes } from './runtime-config-model-center-utils';
import {
  FolderOpenIcon,
  PackageIcon,
  RefreshIcon,
  TrashIcon,
} from './runtime-config-local-model-center-helpers';

type InstalledAssetsSectionProps = {
  modelAssets: NimiRuntimeModelAssetRecord[];
  loadingInstalledAssets: boolean;
  assetBusy: boolean;
  onRefreshAssets: () => void;
  onInspectRemoval: (modelAssetId: string) => Promise<string[]>;
  onRemoveAsset: (modelAssetId: string) => Promise<void>;
};

export function LocalModelCenterInstalledAssetsSection(props: InstalledAssetsSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const [confirmRemoveAssetId, setConfirmRemoveAssetId] = useState('');
  const [removeReferences, setRemoveReferences] = useState<string[]>([]);
  const [expandedAssetId, setExpandedAssetId] = useState('');
  const poolSizeBytes = props.modelAssets.reduce((total, asset) => total + asset.totalSizeBytes, 0);

  const requestRemove = (modelAssetId: string) => {
    void props.onInspectRemoval(modelAssetId).then((references) => {
      setRemoveReferences(references);
      setConfirmRemoveAssetId(modelAssetId);
    }).catch(() => {
      // The owner hook keeps the typed action failure in its dedicated banner.
    });
  };
  const cancelRemove = () => {
    setConfirmRemoveAssetId('');
    setRemoveReferences([]);
  };

  return (
    <section className="overflow-visible rounded-2xl bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)] ring-1 ring-[var(--nimi-border-subtle)]" data-testid="runtime-model-assets">
      <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]">
            <PackageIcon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.localModelCenter.modelAssets', { defaultValue: 'Model Assets' })}
          </h3>
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--nimi-status-success)]">
            {props.modelAssets.length}
          </span>
          <span className="text-xs text-[var(--nimi-text-muted)]" data-testid="runtime-model-asset-pool-size">
            {t('runtimeConfig.localModelCenter.poolCapacity', { defaultValue: 'Pool capacity' })}: {formatBytes(poolSizeBytes)}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefreshAssets}
          disabled={props.loadingInstalledAssets || props.assetBusy}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] disabled:opacity-50"
        >
          <RefreshIcon className="h-3 w-3" />
          {t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>

      {props.loadingInstalledAssets ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.localModelCenter.loadingModelAssets', { defaultValue: 'Loading Model Assets...' })}
        </div>
      ) : props.modelAssets.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <FolderOpenIcon className="mx-auto mb-3 h-6 w-6 text-[var(--nimi-text-muted)]" />
          <h4 className="text-sm font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.localModelCenter.noModelAssets', { defaultValue: 'No Model Assets' })}
          </h4>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.localModelCenter.noModelAssetsDescription', { defaultValue: 'Import a model file or directory. Type and engine are resolved later by a Loadout.' })}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--nimi-border-subtle)]">
          {props.modelAssets.map((asset) => {
            const confirmationVisible = confirmRemoveAssetId === asset.modelAssetId;
            const detailsVisible = expandedAssetId === asset.modelAssetId;
            const provenance = asset.provenance ?? {};
            const provenanceLabel = ['source_kind', 'source_name', 'distribution']
              .map((key) => provenance[key])
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
              .join(' · ');
            const catalogVerificationLabel = asset.catalogVerification === 'matched'
              ? t('runtimeConfig.localModelCenter.catalogVerified', { defaultValue: 'Catalog verified' })
              : asset.catalogVerification === 'not_matched'
                ? t('runtimeConfig.localModelCenter.catalogNotMatched', { defaultValue: 'Not matched to catalog' })
                : t('runtimeConfig.localModelCenter.catalogVerificationUnknown', { defaultValue: 'Catalog verification unknown' });
            return (
              <div key={asset.modelAssetId} className="px-5 py-4" data-model-asset-id={asset.modelAssetId}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]" title={asset.modelAssetId}>
                        {asset.displayName || asset.entry || asset.modelAssetId}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] ${asset.contentVerified ? 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]' : 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]'}`}>
                        {asset.contentVerified
                          ? t('runtimeConfig.localModelCenter.contentVerified', { defaultValue: 'Content verified' })
                          : t('runtimeConfig.localModelCenter.contentUnverified', { defaultValue: 'Content unverified' })}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] ${asset.catalogVerified ? 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]' : 'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]'}`}>
                        {catalogVerificationLabel}
                      </span>
                      {asset.unclassified ? (
                        <span className="rounded bg-[var(--nimi-status-warning-soft-bg)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning-soft-text)]">
                          {t('runtimeConfig.localModelCenter.unclassified', { defaultValue: 'Unclassified' })}
                        </span>
                      ) : null}
                      {asset.duplicateContent ? (
                        <span className="rounded bg-[var(--nimi-status-neutral-soft-bg)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-neutral-soft-text)]">
                          {t('runtimeConfig.localModelCenter.duplicateContent', { defaultValue: 'Duplicate content' })}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]" title={asset.contentId}>{asset.contentId}</p>
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                      {asset.files.length} {t('runtimeConfig.localModelCenter.files', { defaultValue: 'files' })} · {formatBytes(asset.totalSizeBytes)} · {asset.entry}
                    </p>
                    {asset.containsNonExecutableCode ? (
                      <p className="mt-2 text-xs text-[var(--nimi-status-warning)]">
                        {t('runtimeConfig.localModelCenter.nonExecutableCode', { defaultValue: 'Contains code files stored as non-executable content.' })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExpandedAssetId(detailsVisible ? '' : asset.modelAssetId)}
                      className="rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]"
                      aria-expanded={detailsVisible}
                    >
                      {detailsVisible
                        ? t('runtimeConfig.localModelCenter.hideDetails', { defaultValue: 'Hide details' })
                        : t('runtimeConfig.localModelCenter.details', { defaultValue: 'Details' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => requestRemove(asset.modelAssetId)}
                      disabled={props.assetBusy || confirmationVisible}
                      className="rounded-lg p-1.5 text-[var(--nimi-status-danger)] disabled:opacity-50"
                      title={t('runtimeConfig.localModelCenter.remove', { defaultValue: 'Remove' })}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {detailsVisible ? (
                  <div className="mt-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] px-4 py-3" data-testid="runtime-model-asset-details">
                    <dl className="grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModelCenter.modelAssetId', { defaultValue: 'ModelAsset ID' })}</dt>
                        <dd className="break-all font-mono text-[var(--nimi-text-primary)]">{asset.modelAssetId}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModelCenter.provenance', { defaultValue: 'Provenance' })}</dt>
                        <dd className="break-all text-[var(--nimi-text-primary)]">{provenanceLabel || t('runtimeConfig.localModelCenter.provenanceUnknown', { defaultValue: 'Unknown' })}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModelCenter.latestIntegrityCheck', { defaultValue: 'Latest integrity check' })}</dt>
                        <dd className="break-all text-[var(--nimi-text-primary)]">{asset.latestIntegrityCheckedAt || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModelCenter.catalogTrust', { defaultValue: 'Catalog trust' })}</dt>
                        <dd className="text-[var(--nimi-text-primary)]">{catalogVerificationLabel}</dd>
                      </div>
                    </dl>
                    <div className="mt-3">
                      <p className="text-xs font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.localModelCenter.fileDetails', { defaultValue: 'Content files' })}</p>
                      <div className="mt-1 divide-y divide-[var(--nimi-border-subtle)] rounded-lg border border-[var(--nimi-border-subtle)]">
                        {asset.files.map((file) => (
                          <div key={file.relativePath} className="px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="break-all font-mono text-[var(--nimi-text-primary)]">{file.relativePath}</span>
                              <span className="text-[var(--nimi-text-muted)]">{formatBytes(file.sizeBytes)}</span>
                            </div>
                            <p className="mt-1 break-all font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">sha256:{file.sha256}</p>
                            {file.nonExecutableContent ? (
                              <p className="mt-1 text-[var(--nimi-status-warning)]">
                                {t('runtimeConfig.localModelCenter.nonExecutableContent', { defaultValue: 'Stored as non-executable content' })}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {confirmationVisible ? (
                  <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-3">
                    <p className="text-xs text-[var(--nimi-status-danger)]">
                      {t('runtimeConfig.localModelCenter.confirmRemoveModelAsset', { defaultValue: 'Remove this ModelAsset and its owned files?' })}
                      {removeReferences.length > 0
                        ? ` ${t('runtimeConfig.localModelCenter.removeAssetReferences', { defaultValue: 'Referenced by Loadouts: {{references}}.', references: removeReferences.join(', ') })}`
                        : ''}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => { cancelRemove(); void props.onRemoveAsset(asset.modelAssetId).catch(() => undefined); }} className="rounded-lg bg-[var(--nimi-status-danger)] px-3 py-1.5 text-xs font-medium text-white">
                        {t('runtimeConfig.localModelCenter.confirm', { defaultValue: 'Confirm' })}
                      </button>
                      <button type="button" onClick={cancelRemove} className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">
                        {t('Common.cancel', { defaultValue: 'Cancel' })}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
