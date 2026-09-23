import { formatBytes } from '../../components/download-format.js';
import { useState } from 'react';
import type { NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { useDesktopI18nResource } from '../../i18n/i18n-context';

import {
  FolderOpenIcon,
  PackageIcon,
  TrashIcon,
} from './runtime-config-local-model-center-helpers';
import { describeModelAssetPresentation } from './runtime-config-local-model-center-asset-presentation';
import {
  RemoveModelAssetDialog,
  type LocalModelAssetRemovalImpact,
} from './runtime-config-local-model-center-remove-dialog';

type InstalledAssetsSectionProps = {
  modelAssets: NimiRuntimeModelAssetRecord[];
  query?: string;
  loadingInstalledAssets: boolean;
  assetBusy: boolean;
  runtimeWritesDisabled: boolean;
  onRefreshAssets: () => void;
  onInspectRemoval: (modelAssetId: string) => Promise<LocalModelAssetRemovalImpact>;
  onRemoveAsset: (modelAssetId: string) => Promise<void>;
  /** Empty-state shortcut to the Discover tab. */
  onOpenDiscover?: () => void;
  /** Empty-state shortcut to the file import picker. */
  onImportFile?: () => void;
};

export function filterModelAssetsForSearch(assets: readonly NimiRuntimeModelAssetRecord[], query: string): NimiRuntimeModelAssetRecord[] {
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/[\s._-]+/u).filter(Boolean);
  return assets.filter((asset) => {
    const facts = [asset.displayName, asset.modelAssetId, asset.entry, asset.contentId].join(' ').toLowerCase();
    return terms.every((term) => facts.includes(term));
  });
}

export { describeModelAssetPresentation } from './runtime-config-local-model-center-asset-presentation';

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function ChevronDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

const SECONDARY_ACTION_CLASS = 'inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)] hover:text-[var(--nimi-text-primary)] disabled:opacity-50';
const CARD_CLASS = 'rounded-2xl bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] ring-1 ring-[var(--nimi-border-subtle)]';
const META_SEPARATOR = ' · ';

export function LocalModelCenterInstalledAssetsSection(props: InstalledAssetsSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const query = props.query?.trim().toLowerCase() ?? '';
  const visibleAssets = filterModelAssetsForSearch(props.modelAssets, query);
  const [pendingRemoval, setPendingRemoval] = useState<{ readonly modelAssetId: string; readonly impact: LocalModelAssetRemovalImpact } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [expandedAssetId, setExpandedAssetId] = useState('');
  const poolSizeBytes = props.modelAssets.reduce((total, asset) => total + asset.totalSizeBytes, 0);

  const requestRemove = (modelAssetId: string) => {
    void props.onInspectRemoval(modelAssetId).then((impact) => {
      setPendingRemoval({ modelAssetId, impact });
    }).catch(() => {
      // The owner hook keeps the typed action failure in its dedicated banner.
    });
  };
  const cancelRemove = () => {
    if (removing) return;
    setPendingRemoval(null);
  };
  const confirmRemove = () => {
    if (!pendingRemoval || removing) return;
    setRemoving(true);
    void props.onRemoveAsset(pendingRemoval.modelAssetId)
      .catch(() => {
        // The owner hook keeps the typed action failure in its dedicated banner.
      })
      .finally(() => {
        setRemoving(false);
        setPendingRemoval(null);
      });
  };
  const pendingRemovalAsset = pendingRemoval
    ? props.modelAssets.find((asset) => asset.modelAssetId === pendingRemoval.modelAssetId) ?? null
    : null;

  return (
    <section className="space-y-3" data-testid="runtime-model-assets">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.localModelCenter.myModels', { defaultValue: 'Installed Assets' })}
          </h2>
          <span className="rounded-full bg-[var(--nimi-status-neutral-soft-bg)] px-2 py-0.5 text-xs font-medium text-[var(--nimi-status-neutral-soft-text)]">
            {props.modelAssets.length}
          </span>
        </div>
        <span className="text-xs text-[var(--nimi-text-muted)]" data-testid="runtime-model-asset-pool-size">
          {t('runtimeConfig.localModelCenter.poolCapacity', { defaultValue: 'Total model size' })}: {formatBytes(poolSizeBytes)}
        </span>
      </div>

      {props.loadingInstalledAssets ? (
        <div role="status" aria-live="polite" className="space-y-2">
          <span className="sr-only">
            {t('runtimeConfig.localModelCenter.loadingModelAssets', { defaultValue: 'Loading Model Assets...' })}
          </span>
          {[0, 1].map((row) => (
            <div key={row} className={`${CARD_CLASS} flex items-center gap-3 px-4 py-4`} aria-hidden="true">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-[var(--nimi-surface-subtle)]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/3 animate-pulse rounded bg-[var(--nimi-surface-subtle)]" />
                <div className="h-3 w-1/5 animate-pulse rounded bg-[var(--nimi-surface-subtle)]" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleAssets.length === 0 ? (
        <div className={`${CARD_CLASS} px-6 py-12 text-center`}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
            {query ? <FolderOpenIcon className="h-6 w-6" /> : <PackageIcon className="h-6 w-6" />}
          </div>
          <h3 className="text-base font-semibold text-[var(--nimi-text-primary)]">
            {query ? t('runtimeConfig.localModelCenter.noMatchingAssets') : t('runtimeConfig.localModelCenter.noInstalledModels', { defaultValue: 'No local assets' })}
          </h3>
          {!query ? (
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.localModelCenter.noModelAssetsDescription', { defaultValue: 'Download from Model Market, or import your own model files.' })}
            </p>
          ) : null}
          {!query && (props.onOpenDiscover || props.onImportFile) ? (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {props.onOpenDiscover ? (
                <button
                  type="button"
                  onClick={props.onOpenDiscover}
                  className="inline-flex h-9 items-center rounded-full bg-[var(--nimi-action-primary-bg)] px-4 text-sm font-medium text-[var(--nimi-action-primary-text)] transition-opacity hover:opacity-90"
                >
                  {t('runtimeConfig.localModelCenter.emptyDiscoverAction', { defaultValue: 'Discover models' })}
                </button>
              ) : null}
              {props.onImportFile ? (
                <button
                  type="button"
                  onClick={props.onImportFile}
                  className="inline-flex h-9 items-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 text-sm font-medium text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)]"
                >
                  {t('runtimeConfig.localModelCenter.importModelFile', { defaultValue: 'Import Model File' })}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleAssets.map((asset) => {
            const detailsVisible = expandedAssetId === asset.modelAssetId;
            const provenance = asset.provenance ?? {};
            const provenanceLabel = ['source_kind', 'source_name', 'distribution']
              .map((key) => provenance[key])
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
              .join(META_SEPARATOR);
            const catalogVerificationLabel = asset.catalogVerification === 'matched'
              ? t('runtimeConfig.localModelCenter.catalogVerified', { defaultValue: 'Catalog verified' })
              : asset.catalogVerification === 'not_matched'
                ? t('runtimeConfig.localModelCenter.catalogNotMatched', { defaultValue: 'Not matched to catalog' })
                : t('runtimeConfig.localModelCenter.catalogVerificationUnknown', { defaultValue: 'Catalog verification unknown' });
            const presentation = describeModelAssetPresentation(asset);
            const metaText = [
              `${asset.files.length} ${t('runtimeConfig.localModelCenter.files', { defaultValue: 'files' })}`,
              formatBytes(asset.totalSizeBytes),
            ].join(META_SEPARATOR);
            return (
              <article
                key={asset.modelAssetId}
                className={`${CARD_CLASS} px-4 py-3.5 transition-shadow hover:shadow-[var(--nimi-elevation-raised)]`}
                data-model-asset-id={asset.modelAssetId}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${asset.contentVerified
                      ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]'
                      : 'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]'}`}
                    aria-hidden="true"
                  >
                    <PackageIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]" title={asset.modelAssetId}>
                        {presentation.title}
                      </span>
                      {presentation.format ? (
                        <span className="shrink-0 rounded-md bg-[var(--nimi-status-neutral-soft-bg)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] font-semibold tracking-wide text-[var(--nimi-status-neutral-soft-text)]">
                          {presentation.format}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--nimi-text-muted)]">
                      <span className={`inline-flex items-center gap-1 ${asset.contentVerified ? 'text-[var(--nimi-status-success)]' : 'text-[var(--nimi-status-danger)]'}`}>
                        {asset.contentVerified ? <CheckIcon className="h-3 w-3" /> : null}
                        {asset.contentVerified
                          ? t('runtimeConfig.localModelCenter.contentVerified', { defaultValue: 'Content verified' })
                          : t('runtimeConfig.localModelCenter.contentUnverified', { defaultValue: 'Content unverified' })}
                      </span>
                      <span>{META_SEPARATOR.trim()}</span>
                      <span>{metaText}</span>
                    </p>
                    {asset.containsNonExecutableCode ? (
                      <p className="mt-1.5 text-xs text-[var(--nimi-status-warning)]">
                        {t('runtimeConfig.localModelCenter.nonExecutableCode', { defaultValue: 'Contains code files stored as non-executable content.' })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExpandedAssetId(detailsVisible ? '' : asset.modelAssetId)}
                      className={SECONDARY_ACTION_CLASS}
                      aria-expanded={detailsVisible}
                    >
                      {detailsVisible
                        ? t('runtimeConfig.localModelCenter.hideDetails', { defaultValue: 'Hide details' })
                        : t('runtimeConfig.localModelCenter.details', { defaultValue: 'Details' })}
                      <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${detailsVisible ? 'rotate-180' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => requestRemove(asset.modelAssetId)}
                      disabled={props.assetBusy || removing || props.runtimeWritesDisabled}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-status-danger-soft-bg)] hover:text-[var(--nimi-status-danger)] disabled:opacity-50"
                      title={t('runtimeConfig.localModelCenter.remove', { defaultValue: 'Remove' })}
                      aria-label={t('runtimeConfig.localModelCenter.remove', { defaultValue: 'Remove' })}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {detailsVisible ? (
                  <div className="mt-3 rounded-xl bg-[var(--nimi-surface-subtle)] px-4 py-3" data-testid="runtime-model-asset-details">
                    <p className="text-xs font-semibold text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.localModelCenter.developerInfo', { defaultValue: 'Developer Info' })}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
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
                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModelCenter.modelAssetId', { defaultValue: 'ModelAsset ID' })}</dt>
                        <dd className="break-all font-mono text-[var(--nimi-text-primary)]">{asset.modelAssetId}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModelCenter.contentId', { defaultValue: 'Content ID' })}</dt>
                        <dd className="break-all font-mono text-[var(--nimi-text-primary)]">{asset.contentId}</dd>
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
                      <div className="mt-1 divide-y divide-[var(--nimi-border-subtle)] rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
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
              </article>
            );
          })}
        </div>
      )}
      {pendingRemoval && pendingRemovalAsset ? (
        <RemoveModelAssetDialog
          open
          asset={pendingRemovalAsset}
          impact={pendingRemoval.impact}
          removing={removing}
          onConfirm={confirmRemove}
          onClose={cancelRemove}
        />
      ) : null}
    </section>
  );
}
