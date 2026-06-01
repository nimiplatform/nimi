import { useState } from 'react';
import type {
  LocalRuntimeAssetKind,
  LocalRuntimeAssetRecord,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
import {
  LOCAL_RUNTIME_ASSET_KIND_IDS,
  LOCAL_RUNTIME_PASSIVE_ASSET_KIND_IDS,
  buildLocalRecommendationDetailItems,
  compareLocalRuntimeAssetKindForDisplay,
  formatLocalRecommendationBaselineLabel,
  formatLocalRecommendationConfidenceLabel,
  formatLocalRecommendationHostSupportLabel,
  formatLocalRecommendationReasonLabel,
  formatLocalRuntimeAssetKindLabel,
  summarizeLocalCatalogRecommendation,
  type LocalRecommendationCopyOptions,
  type LocalRecommendationDetailItem,
} from '@nimiplatform/sdk/runtime';
import { formatRelativeLocaleTime, i18n } from '@renderer/i18n';
import { parseTimestamp } from './runtime-config-model-center-utils';
export {
  DownloadIcon,
  FolderOpenIcon,
  HeartPulseIcon,
  ModelIcon,
  PackageIcon,
  RefreshIcon,
  SearchIcon,
  StarIcon,
  Toggle,
  TrashIcon,
} from './runtime-config-local-model-center-icons';
export {
  cacheProgressSessions,
  getCachedProgressSessions,
  getDismissedSessionIds,
  addDismissedSessionId,
  removeDismissedSessionId,
} from './runtime-config-local-model-center-progress-cache';

export const ASSET_KIND_OPTIONS = LOCAL_RUNTIME_PASSIVE_ASSET_KIND_IDS;
export const ALL_ASSET_KIND_OPTIONS = LOCAL_RUNTIME_ASSET_KIND_IDS;
const LOCAL_RECOMMENDATION_COPY_OPTIONS: LocalRecommendationCopyOptions = {
  translate: (key, options) => i18n.t(key, options),
};

export function formatAssetKindLabel(value: LocalRuntimeAssetKind): string {
  return formatLocalRuntimeAssetKindLabel(value);
}

const GENERIC_MODEL_TAGS = new Set([
  'verified',
  'recommended',
  'chat',
  'image',
  'video',
  'tts',
  'stt',
  'embedding',
  'llama',
  'media',
  'sidecar',
]);

function normalizeDescriptorToken(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

function collectAssetFamilyHints(asset: LocalRuntimeVerifiedAssetDescriptor): string[] {
  const hints = new Set<string>();
  for (const tag of asset.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.has(normalized)) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

export function hasDescriptorTag(
  tags: string[] | undefined | null,
  target: string,
): boolean {
  const normalizedTarget = normalizeDescriptorToken(target);
  if (!normalizedTarget) {
    return false;
  }
  return (tags || []).some((tag) => normalizeDescriptorToken(tag) === normalizedTarget);
}

export function isRecommendedDescriptor(tags: string[] | undefined | null): boolean {
  return hasDescriptorTag(tags, 'recommended');
}

function compareDescriptorTitles(
  leftTitle: string,
  leftId: string,
  rightTitle: string,
  rightId: string,
): number {
  const byTitle = leftTitle.localeCompare(rightTitle, undefined, { sensitivity: 'base' });
  if (byTitle !== 0) {
    return byTitle;
  }
  return leftId.localeCompare(rightId, undefined, { sensitivity: 'base' });
}

export function sortVerifiedAssetsForDisplay(
  assets: LocalRuntimeVerifiedAssetDescriptor[],
): LocalRuntimeVerifiedAssetDescriptor[] {
  return [...assets].sort((left, right) => {
    const leftRecommended = isRecommendedDescriptor(left.tags);
    const rightRecommended = isRecommendedDescriptor(right.tags);
    if (leftRecommended !== rightRecommended) {
      return leftRecommended ? -1 : 1;
    }
    return compareDescriptorTitles(left.title, left.templateId, right.title, right.templateId);
  });
}

export function sortVerifiedPassiveAssetsForDisplay(
  assets: LocalRuntimeVerifiedAssetDescriptor[],
): LocalRuntimeVerifiedAssetDescriptor[] {
  return [...assets].sort((left, right) => {
    const leftRecommended = isRecommendedDescriptor(left.tags);
    const rightRecommended = isRecommendedDescriptor(right.tags);
    if (leftRecommended !== rightRecommended) {
      return leftRecommended ? -1 : 1;
    }
    const byKind = compareLocalRuntimeAssetKindForDisplay(left.kind, right.kind);
    if (byKind !== 0) {
      return byKind;
    }
    return compareDescriptorTitles(left.title, left.templateId, right.title, right.templateId);
  });
}

function collectPassiveAssetFamilyHints(asset: LocalRuntimeVerifiedAssetDescriptor): string[] {
  const hints = new Set<string>();
  const family = normalizeDescriptorToken(typeof asset.metadata?.family === 'string' ? asset.metadata.family : '');
  if (family) {
    hints.add(family);
  }
  for (const tag of asset.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.has(normalized)) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

export function filterInstalledAssets(
  assets: LocalRuntimeAssetRecord[],
  kindFilter: 'all' | LocalRuntimeAssetKind,
  query: string,
): LocalRuntimeAssetRecord[] {
  return assets.filter((asset) => {
    if (asset.status === 'removed') return false;
    const matchesKind = kindFilter === 'all' || asset.kind === kindFilter;
    if (!matchesKind) return false;
    if (!query) return true;
    return (
      asset.assetId.toLowerCase().includes(query)
      || asset.localAssetId.toLowerCase().includes(query)
      || asset.engine.toLowerCase().includes(query)
      || asset.kind.toLowerCase().includes(query)
      || asset.source.repo.toLowerCase().includes(query)
    );
  });
}

export function relatedPassiveAssetsForRunnable(
  runnable: LocalRuntimeVerifiedAssetDescriptor,
  passiveAssets: LocalRuntimeVerifiedAssetDescriptor[],
): LocalRuntimeVerifiedAssetDescriptor[] {
  const capabilities = new Set((runnable.capabilities || []).map((value) => normalizeDescriptorToken(value)));
  if (!capabilities.has('image')) {
    return [];
  }
  const runnableFamilies = new Set(collectAssetFamilyHints(runnable));
  if (runnableFamilies.size === 0) {
    return [];
  }
  return passiveAssets.filter((asset) => {
    const assetFamilies = collectPassiveAssetFamilyHints(asset);
    return assetFamilies.some((family) => runnableFamilies.has(family));
  });
}

export type AssetTaskState = 'running' | 'completed' | 'failed';

export type AssetTaskEntry = {
  templateId: string;
  assetId: string;
  title: string;
  kind: LocalRuntimeAssetKind;
  taskKind: 'verified-install';
  state: AssetTaskState;
  detail?: string;
  updatedAtMs: number;
};

export function isAssetTaskTerminal(state: AssetTaskState): boolean {
  return state === 'completed' || state === 'failed';
}

export function assetTaskStatusLabel(state: AssetTaskState): string {
  if (state === 'running') return 'Installing';
  if (state === 'completed') return 'Installed';
  return 'Failed';
}

export function formatLastCheckedAgo(lastCheckedAt: string | null): string {
  if (!lastCheckedAt) {
    return i18n.t('runtimeConfig.local.notCheckedYet', { defaultValue: 'Not checked yet' });
  }
  const ts = parseTimestamp(lastCheckedAt);
  if (!ts) {
    return i18n.t('runtimeConfig.local.lastCheckedRaw', {
      value: lastCheckedAt,
      defaultValue: 'Last checked: {{value}}',
    });
  }
  return i18n.t('runtimeConfig.local.checkedAgo', {
    value: formatRelativeLocaleTime(new Date(ts)),
    defaultValue: 'Checked {{value}}',
  });
}

export function recommendationTierLabel(value?: LocalRuntimeCatalogRecommendation['tier']): string {
  if (value === 'recommended') return 'Recommended';
  if (value === 'runnable') return 'Runnable';
  if (value === 'tight') return 'Tight';
  if (value === 'not_recommended') return 'Not Recommended';
  return 'Needs Review';
}

export function recommendationTierClass(value?: LocalRuntimeCatalogRecommendation['tier']): string {
  if (value === 'recommended') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-[var(--nimi-status-success)]';
  if (value === 'runnable') return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_15%,transparent)] text-[var(--nimi-status-info)]';
  if (value === 'tight') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] text-[var(--nimi-status-warning)]';
  if (value === 'not_recommended') return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_15%,transparent)] text-[var(--nimi-status-danger)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-status-neutral)_15%,transparent)] text-[var(--nimi-status-neutral)]';
}

export function recommendationHostSupportLabel(
  value?: LocalRuntimeCatalogRecommendation['hostSupportClass'],
): string {
  return formatLocalRecommendationHostSupportLabel(value);
}

export function recommendationConfidenceLabel(
  value?: LocalRuntimeCatalogRecommendation['confidence'],
): string {
  return formatLocalRecommendationConfidenceLabel(value);
}

export function recommendationBaselineLabel(
  value?: LocalRuntimeCatalogRecommendation['baseline'],
): string {
  return formatLocalRecommendationBaselineLabel(value, LOCAL_RECOMMENDATION_COPY_OPTIONS);
}

export function recommendationReasonLabel(code: string): string {
  return formatLocalRecommendationReasonLabel(code, LOCAL_RECOMMENDATION_COPY_OPTIONS);
}

export function recommendationSummary(
  recommendation: LocalRuntimeCatalogRecommendation | undefined,
): string {
  return summarizeLocalCatalogRecommendation(recommendation, LOCAL_RECOMMENDATION_COPY_OPTIONS);
}

export function recommendationDetailItems(
  recommendation: LocalRuntimeCatalogRecommendation | undefined,
  options?: {
    maxFallbackEntries?: number;
    includeNote?: boolean;
  },
): LocalRecommendationDetailItem[] {
  return buildLocalRecommendationDetailItems(recommendation, {
    ...LOCAL_RECOMMENDATION_COPY_OPTIONS,
    maxFallbackEntries: options?.maxFallbackEntries,
    includeNote: options?.includeNote,
  });
}

export function RecommendationDetailList(props: {
  recommendation: LocalRuntimeCatalogRecommendation | undefined;
  className?: string;
  rowClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  maxFallbackEntries?: number;
  includeNote?: boolean;
}) {
  const items = recommendationDetailItems(props.recommendation, {
    maxFallbackEntries: props.maxFallbackEntries,
    includeNote: props.includeNote,
  });
  if (items.length === 0) {
    return null;
  }
  return (
    <div className={props.className || 'mt-2 space-y-1'}>
      {items.map((item) => (
        <p key={item.key} className={props.rowClassName || 'text-[11px] text-[var(--nimi-text-muted)]'}>
          <span className={props.labelClassName || 'font-medium text-[var(--nimi-text-secondary)]'}>{item.label}:</span>{' '}
          <span className={props.valueClassName || ''}>{item.value}</span>
        </p>
      ))}
    </div>
  );
}

export function RecommendationDiagnosticsPanel(props: {
  recommendation: LocalRuntimeCatalogRecommendation | undefined;
  className?: string;
  buttonClassName?: string;
  panelClassName?: string;
}) {
  const recommendation = props.recommendation;
  const [open, setOpen] = useState(false);
  if (!recommendation) {
    return null;
  }
  const reasonCodes = recommendation.reasonCodes.map((item) => item.trim()).filter(Boolean);
  const hasDiagnostics = Boolean(recommendation.source || recommendation.format || reasonCodes.length > 0);
  if (!hasDiagnostics) {
    return null;
  }
  return (
    <div className={props.className || 'mt-2'}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={props.buttonClassName || 'text-[10px] font-medium text-[var(--nimi-text-muted)] underline decoration-[color:var(--nimi-border-subtle)] underline-offset-2 hover:text-[var(--nimi-text-secondary)]'}
      >
        {open
          ? i18n.t('runtimeConfig.local.recommendationDiagnosticsHide', {
              defaultValue: 'Hide diagnostics',
            })
          : i18n.t('runtimeConfig.local.recommendationDiagnosticsShow', {
              defaultValue: 'Show diagnostics',
            })}
      </button>
      {open ? (
        <div className={props.panelClassName || 'mt-2 space-y-2 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-[10px] text-[var(--nimi-text-secondary)]'}>
          <p className="font-medium text-[var(--nimi-text-primary)]">
            {i18n.t('runtimeConfig.local.recommendationDiagnosticsTitle', {
              defaultValue: 'Recommendation diagnostics',
            })}
          </p>
          <div className="space-y-1">
            <p>
              <span className="font-medium text-[var(--nimi-text-primary)]">
                {i18n.t('runtimeConfig.local.recommendationDiagnosticsSource', {
                  defaultValue: 'Source',
                })}
                :
              </span>{' '}
              <span className="font-mono">{recommendation.source}</span>
            </p>
            {recommendation.format ? (
              <p>
                <span className="font-medium text-[var(--nimi-text-primary)]">
                  {i18n.t('runtimeConfig.local.recommendationDiagnosticsFormat', {
                    defaultValue: 'Format',
                  })}
                  :
                </span>{' '}
                <span className="font-mono">{recommendation.format}</span>
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <p className="font-medium text-[var(--nimi-text-primary)]">
              {i18n.t('runtimeConfig.local.recommendationDiagnosticsReasonCodes', {
                defaultValue: 'Reason codes',
              })}
              :
            </p>
            {reasonCodes.length > 0 ? (
              <div className="space-y-1">
                {reasonCodes.map((reasonCode) => (
                  <div
                    key={reasonCode}
                    className="rounded border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1 text-[var(--nimi-text-secondary)]"
                  >
                    <p>{recommendationReasonLabel(reasonCode)}</p>
                    <p className="font-mono text-[10px] text-[var(--nimi-text-muted)]">{reasonCode}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                {i18n.t('runtimeConfig.local.recommendationDiagnosticsNone', {
                  defaultValue: 'No reason codes recorded.',
                })}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
