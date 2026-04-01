import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalModelOptionV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { localRuntime } from '@runtime/local-runtime';
import { StatusBadge } from './runtime-config-primitives';
import { filterInstalledModels, statusLabel } from './runtime-config-model-center-utils';
import {
  recommendationBaselineLabel,
  recommendationConfidenceLabel,
  recommendationHostSupportLabel,
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
} from './runtime-config-local-model-center-helpers';

// Icons
function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function PlayIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function StopIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
}

function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CpuIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}

function ChevronDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// Button Component
function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  icon,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const variantClass = variant === 'primary'
    ? 'bg-[var(--nimi-action-primary-bg)] text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:bg-[color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)]'
    : variant === 'secondary'
      ? 'border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] bg-white text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] disabled:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]'
      : variant === 'danger'
        ? 'border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] disabled:opacity-50'
        : 'text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]';

  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:cursor-not-allowed hover:shadow-sm ${variantClass} ${sizeClass}`}
    >
      {icon}
      {children}
    </button>
  );
}

export type ModelCenterInstalledListProps = {
  sortedModels: LocalModelOptionV11[];
  highlightLocalModelId: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onStart: (localModelId: string) => Promise<void>;
  onStop: (localModelId: string) => Promise<void>;
  onRestart: (localModelId: string) => Promise<void>;
  onRemove: (localModelId: string) => Promise<void>;
};

export function ModelCenterInstalledList(props: ModelCenterInstalledListProps) {
  const { t } = useTranslation();
  const [busyByModelId, setBusyByModelId] = useState<Record<string, boolean>>({});
  const [errorByModelId, setErrorByModelId] = useState<Record<string, string>>({});
  const [confirmRemoveModelId, setConfirmRemoveModelId] = useState('');
  const [expandedModelId, setExpandedModelId] = useState('');

  const runWithModelBusy = async (localModelId: string, task: () => Promise<void>) => {
    setBusyByModelId((prev) => ({ ...prev, [localModelId]: true }));
    setErrorByModelId((prev) => ({ ...prev, [localModelId]: '' }));
    try {
      await task();
    } catch (err) {
      setErrorByModelId((prev) => ({
        ...prev,
        [localModelId]: err instanceof Error ? err.message : String(err || 'Operation failed'),
      }));
    } finally {
      setBusyByModelId((prev) => ({ ...prev, [localModelId]: false }));
    }
  };

  const filteredModels = useMemo(
    () => filterInstalledModels(props.sortedModels, props.searchQuery),
    [props.searchQuery, props.sortedModels],
  );

  if (filteredModels.length === 0) {
    return (
      <div className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
            <CpuIcon className="h-6 w-6 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
          </div>
          <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.local.noModelsInstalled', { defaultValue: 'No Assets Installed' })}
          </p>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {props.sortedModels.length === 0
              ? t('runtimeConfig.local.noModelsInstalledDesc', {
                  defaultValue: 'No local asset registered. Install or import one to enable Local Runtime capability resolution.',
                })
              : t('runtimeConfig.local.noModelsMatchFilter', { defaultValue: 'No assets match the current filter.' })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] bg-white shadow-sm overflow-hidden">
      {/* Search Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_52%,transparent)]">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
          <input
            type="text"
            value={props.searchQuery}
            onChange={(e) => props.onSearchQueryChange(e.target.value)}
            placeholder={t('runtimeConfig.local.filterInstalledModels', { defaultValue: 'Filter installed models...' })}
            className="w-full rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] py-2 pl-9 pr-4 text-sm text-[var(--nimi-text-primary)] outline-none transition-all placeholder:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100"
          />
        </div>
        <span className="text-xs text-[var(--nimi-text-muted)] whitespace-nowrap">
          {filteredModels.length} / {props.sortedModels.length}
        </span>
      </div>

      {/* Model List */}
      <div className="divide-y divide-[color-mix(in_srgb,var(--nimi-border-subtle)_52%,transparent)]">
        {filteredModels.map((model) => {
          const busy = Boolean(busyByModelId[model.localModelId]);
          const status = statusLabel(model.status);
          const isExpanded = expandedModelId === model.localModelId;
          const isConfirmingRemove = confirmRemoveModelId === model.localModelId;
          const error = errorByModelId[model.localModelId];
          const isHighlighted = props.highlightLocalModelId === model.localModelId;

          return (
            <div
              key={`local-model-${model.localModelId}`}
              className={`${isHighlighted ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/50' : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/50'} transition-colors`}
            >
              <div className="px-5 py-4">
                {/* Header Row */}
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="flex flex-1 items-center gap-3 text-left min-w-0"
                    onClick={() => setExpandedModelId(isExpanded ? '' : model.localModelId)}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]">
                      <CpuIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{model.model}</p>
                        {isHighlighted && (
                          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-status-success)]">
                            New
                          </span>
                        )}
                        {model.recommendation ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${recommendationTierClass(model.recommendation.tier)}`}>
                            {recommendationTierLabel(model.recommendation.tier)}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-[var(--nimi-text-muted)]">
                        {model.localModelId} · {model.engine}
                      </p>
                      {model.recommendation ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-text-muted)]">
                          {recommendationSummary(model.recommendation)}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
                      {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </div>
                  </button>
                  <StatusBadge status={status} />
                </div>

                {/* Capabilities */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(model.capabilities || ['chat']).map((cap) => (
                    <span
                      key={cap}
                      className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-text-secondary)]"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-3 space-y-2 rounded-xl border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] p-4 text-xs text-[var(--nimi-text-secondary)]">
                    <div className="grid grid-cols-2 gap-2">
                      <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.endpoint', { defaultValue: 'Endpoint' })}:</span> {model.endpoint}</p>
                      <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.engine', { defaultValue: 'Engine' })}:</span> {model.engine}</p>
                      <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.status', { defaultValue: 'Status' })}:</span> {model.status}</p>
                      <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.installed', { defaultValue: 'Installed' })}:</span> {model.installedAt || '-'}</p>
                    </div>
                    <p>
                      <span className="font-medium text-[var(--nimi-text-secondary)]">
                        {t('runtimeConfig.local.sourceIntegrity', { defaultValue: 'Source' })}:
                      </span>{' '}
                      {model.integrityMode === 'local_unverified'
                        ? t('runtimeConfig.local.sourceIntegrityLocalImport', { defaultValue: 'Local import (not provenance-verified)' })
                        : t('runtimeConfig.local.sourceIntegrityVerified', { defaultValue: 'Verified source' })}
                    </p>
                    {model.hash && <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.hash', { defaultValue: 'Hash' })}:</span> {model.hash}</p>}
                    {model.updatedAt && model.updatedAt !== model.installedAt && (
                      <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.updated', { defaultValue: 'Updated' })}:</span> {model.updatedAt}</p>
                    )}
                    {model.recommendation ? (
                      <div className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-3 py-2 text-[11px] text-[var(--nimi-text-secondary)]">
                        <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.recommendation', { defaultValue: 'Recommendation' })}:</span> {recommendationTierLabel(model.recommendation.tier)}</p>
                        <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.host', { defaultValue: 'Host' })}:</span> {recommendationHostSupportLabel(model.recommendation.hostSupportClass)}</p>
                        <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.confidence', { defaultValue: 'Confidence' })}:</span> {recommendationConfidenceLabel(model.recommendation.confidence)}</p>
                        {model.recommendation.baseline ? (
                          <p><span className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.local.baseline', { defaultValue: 'Baseline' })}:</span> {recommendationBaselineLabel(model.recommendation.baseline)}</p>
                        ) : null}
                        <RecommendationDetailList
                          recommendation={model.recommendation}
                          className="space-y-1 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] pt-2"
                          rowClassName="text-[11px] text-[var(--nimi-text-secondary)]"
                          labelClassName="font-medium text-[var(--nimi-text-secondary)]"
                          maxFallbackEntries={3}
                        />
                        <RecommendationDiagnosticsPanel recommendation={model.recommendation} />
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Error Message */}
                {error && (
                  <p className="mt-2 text-xs text-[var(--nimi-status-danger)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] rounded-lg px-3 py-2">{error}</p>
                )}

                {/* Action Buttons */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || model.status === 'active'}
                    onClick={() => {
                      void runWithModelBusy(model.localModelId, async () => {
                        await props.onStart(model.localModelId);
                      });
                    }}
                    icon={<PlayIcon />}
                  >
                    {t('runtimeConfig.overview.start', { defaultValue: 'Start' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || model.status !== 'active'}
                    onClick={() => {
                      void runWithModelBusy(model.localModelId, async () => {
                        await props.onStop(model.localModelId);
                      });
                    }}
                    icon={<StopIcon />}
                  >
                    {t('runtimeConfig.overview.stop', { defaultValue: 'Stop' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void runWithModelBusy(model.localModelId, async () => {
                        await props.onRestart(model.localModelId);
                      });
                    }}
                    icon={<RefreshIcon />}
                  >
                    {t('runtimeConfig.overview.restart', { defaultValue: 'Restart' })}
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void localRuntime.revealInFolder(model.localModelId);
                    }}
                    icon={<FolderIcon />}
                  >
                    {t('runtimeConfig.local.reveal', { defaultValue: 'Reveal' })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || isConfirmingRemove}
                    onClick={() => setConfirmRemoveModelId(model.localModelId)}
                    icon={<TrashIcon />}
                  >
                    {t('runtimeConfig.local.remove', { defaultValue: 'Remove' })}
                  </Button>
                </div>

                {/* Confirm Remove */}
                {isConfirmingRemove && (
                  <div className="mt-3 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-3">
                    <p className="flex-1 text-sm text-[var(--nimi-status-danger)]">
                      {t('runtimeConfig.local.confirmRemove', {
                        defaultValue: 'Remove "{{name}}"? Local model files will be permanently deleted.',
                        name: model.model,
                      })}
                    </p>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setConfirmRemoveModelId('');
                        void runWithModelBusy(model.localModelId, async () => {
                          await props.onRemove(model.localModelId);
                        });
                      }}
                    >
                      {t('runtimeConfig.local.confirm', { defaultValue: 'Confirm' })}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmRemoveModelId('')}
                    >
                      {t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
