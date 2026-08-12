import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import type {
  NimiRuntimeLocalAssetKind,
  NimiRuntimeLocalAssetRecord,
  NimiRuntimeLocalCatalogRecommendation,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
import {
  NIMI_RUNTIME_LOCAL_ASSET_KIND_IDS,
  NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_IDS,
  buildNimiRuntimeLocalRecommendationDetailItems,
  formatNimiRuntimeLocalRecommendationBaselineLabel,
  formatNimiRuntimeLocalRecommendationConfidenceLabel,
  formatNimiRuntimeLocalRecommendationHostSupportLabel,
  formatNimiRuntimeLocalRecommendationReasonLabel,
  formatNimiRuntimeLocalAssetKindLabel,
  summarizeNimiRuntimeLocalCatalogRecommendation,
  type NimiRuntimeLocalRecommendationCopyOptions,
  type NimiRuntimeLocalRecommendationDetailItem,
} from '@nimiplatform/sdk/runtime';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { parseTimestamp } from './runtime-config-model-center-utils';
import { tierPillClass } from './runtime-config-runtime-page-ui';
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
export const ASSET_KIND_OPTIONS = NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_IDS;
export const ALL_ASSET_KIND_OPTIONS = NIMI_RUNTIME_LOCAL_ASSET_KIND_IDS;
function recommendationCopyOptions(t: TFunction): NimiRuntimeLocalRecommendationCopyOptions {
  return { translate: (key, options) => t(key, options) };
}

export function formatAssetKindLabel(value: NimiRuntimeLocalAssetKind): string {
  return formatNimiRuntimeLocalAssetKindLabel(value);
}

export function localizedAssetKindLabel(value: NimiRuntimeLocalAssetKind, t: TFunction): string {
  return t(`runtimeConfig.localModelCenter.kindLabels.${value}`, {
    defaultValue: formatNimiRuntimeLocalAssetKindLabel(value),
  });
}

const IMPORT_INSTANCE_TAIL_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

export function assetIdDisplaySlug(assetId: string): string {
  const segments = String(assetId || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const tail = segments[segments.length - 1] || '';
  if (!tail) {
    return '';
  }
  const previous = segments[segments.length - 2] || '';
  if (previous && IMPORT_INSTANCE_TAIL_PATTERN.test(tail)) {
    return previous;
  }
  return tail;
}

export function assetDisplayName(asset: NimiRuntimeLocalAssetRecord): string {
  const displayName = String(asset.displayName || '').trim();
  if (displayName) {
    return displayName;
  }
  return assetIdDisplaySlug(asset.assetId) || String(asset.assetId || '').trim();
}

const ASSET_CAPABILITY_LABEL_KEYS: Record<string, string> = {
  chat: 'chat',
  'text.generate': 'textGenerate',
  'text.embed': 'embedding',
  embedding: 'embedding',
  image: 'imageGenerate',
  'image.generate': 'imageGenerate',
  video: 'videoGenerate',
  'video.generate': 'videoGenerate',
  tts: 'tts',
  'audio.synthesize': 'tts',
  stt: 'stt',
  'audio.transcribe': 'stt',
  'voice.create': 'voiceCreate',
};

export function localizedAssetCapabilityLabels(
  capabilities: readonly string[] | undefined,
  t: TFunction,
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities || []) {
    const labelKey = ASSET_CAPABILITY_LABEL_KEYS[String(capability || '').trim().toLowerCase()];
    if (!labelKey) {
      continue;
    }
    const label = t(`runtimeConfig.localModelCenter.capabilityLabels.${labelKey}`);
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    labels.push(label);
    if (labels.length >= 3) {
      break;
    }
  }
  return labels;
}

export function installedAssetSourceLabel(asset: NimiRuntimeLocalAssetRecord, t: TFunction): string {
  const repo = String(asset.source?.repo || '').trim().toLowerCase();
  if (repo.startsWith('file://')) {
    return t('runtimeConfig.localModelCenter.sourceLocalImport', { defaultValue: 'Local import' });
  }
  return t('runtimeConfig.localModelCenter.sourceCatalogInstall', { defaultValue: 'Catalog install' });
}

export function installedAssetMetaLine(asset: NimiRuntimeLocalAssetRecord, i18n: DesktopI18nResource): string {
  const t = i18n.instance.t.bind(i18n.instance);
  const sourceLabel = installedAssetSourceLabel(asset, t);
  const installedAtMs = parseTimestamp(asset.installedAt);
  if (!installedAtMs) {
    return sourceLabel;
  }
  const installedLabel = t('runtimeConfig.localModelCenter.installedAtRelative', {
    value: i18n.formatRelativeTime(new Date(installedAtMs)),
    defaultValue: 'Installed {{value}}',
  });
  return `${sourceLabel} · ${installedLabel}`;
}

const GENERIC_MODEL_TAGS = [
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
] as const;

function normalizeDescriptorToken(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

function collectAssetFamilyHints(asset: NimiRuntimeLocalVerifiedAssetDescriptor): string[] {
  const hints = new Set<string>();
  for (const tag of asset.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.includes(normalized as (typeof GENERIC_MODEL_TAGS)[number])) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

export function hasDescriptorTag(
  tags: readonly string[] | undefined | null,
  target: string,
): boolean {
  const normalizedTarget = normalizeDescriptorToken(target);
  if (!normalizedTarget) {
    return false;
  }
  return (tags || []).some((tag) => normalizeDescriptorToken(tag) === normalizedTarget);
}

export function isRecommendedDescriptor(tags: readonly string[] | undefined | null): boolean {
  return hasDescriptorTag(tags, 'recommended');
}

function collectPassiveAssetFamilyHints(asset: NimiRuntimeLocalVerifiedAssetDescriptor): string[] {
  const hints = new Set<string>();
  const family = normalizeDescriptorToken(typeof asset.metadata?.family === 'string' ? asset.metadata.family : '');
  if (family) {
    hints.add(family);
  }
  for (const tag of asset.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.includes(normalized as (typeof GENERIC_MODEL_TAGS)[number])) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

export function filterInstalledAssets(
  assets: NimiRuntimeLocalAssetRecord[],
  kindFilter: 'all' | NimiRuntimeLocalAssetKind,
  query: string,
): NimiRuntimeLocalAssetRecord[] {
  return assets.filter((asset) => {
    if (asset.status === 'removed') return false;
    const matchesKind = kindFilter === 'all' || asset.kind === kindFilter;
    if (!matchesKind) return false;
    if (!query) return true;
    return (
      asset.displayName.toLowerCase().includes(query)
      || asset.assetId.toLowerCase().includes(query)
      || asset.localAssetId.toLowerCase().includes(query)
      || asset.engine.toLowerCase().includes(query)
      || asset.kind.toLowerCase().includes(query)
      || asset.source.repo.toLowerCase().includes(query)
    );
  });
}

export function relatedPassiveAssetsForRunnable(
  runnable: NimiRuntimeLocalVerifiedAssetDescriptor,
  passiveAssets: NimiRuntimeLocalVerifiedAssetDescriptor[],
): NimiRuntimeLocalVerifiedAssetDescriptor[] {
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
  kind: NimiRuntimeLocalAssetKind;
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

export function formatLastCheckedAgo(
  lastCheckedAt: string | null,
  i18n: DesktopI18nResource,
): string {
  const t = i18n.instance.t.bind(i18n.instance);
  if (!lastCheckedAt) {
    return t('runtimeConfig.local.notCheckedYet', { defaultValue: 'Not checked yet' });
  }
  const ts = parseTimestamp(lastCheckedAt);
  if (!ts) {
    return t('runtimeConfig.local.lastCheckedRaw', {
      value: lastCheckedAt,
      defaultValue: 'Last checked: {{value}}',
    });
  }
  return t('runtimeConfig.local.checkedAgo', {
    value: i18n.formatRelativeTime(new Date(ts)),
    defaultValue: 'Checked {{value}}',
  });
}

export function recommendationTierLabel(value?: NimiRuntimeLocalCatalogRecommendation['tier']): string {
  if (value === 'recommended') return 'Recommended';
  if (value === 'runnable') return 'Runnable';
  if (value === 'tight') return 'Tight';
  if (value === 'not_recommended') return 'Not Recommended';
  return 'Needs Review';
}

export function recommendationTierClass(value?: NimiRuntimeLocalCatalogRecommendation['tier']): string {
  // Delegate to the shared tier pill mapping so this page and the recommend
  // page render identical tier colors (soft status tokens).
  return tierPillClass(value);
}

export function recommendationHostSupportLabel(
  value?: NimiRuntimeLocalCatalogRecommendation['hostSupportClass'],
): string {
  return formatNimiRuntimeLocalRecommendationHostSupportLabel(value);
}

export function recommendationConfidenceLabel(
  value?: NimiRuntimeLocalCatalogRecommendation['confidence'],
): string {
  return formatNimiRuntimeLocalRecommendationConfidenceLabel(value);
}

export function recommendationBaselineLabel(
  value: NimiRuntimeLocalCatalogRecommendation['baseline'] | undefined,
  t: TFunction,
): string {
  return formatNimiRuntimeLocalRecommendationBaselineLabel(value, recommendationCopyOptions(t));
}

export function recommendationReasonLabel(code: string, t: TFunction): string {
  return formatNimiRuntimeLocalRecommendationReasonLabel(code, recommendationCopyOptions(t));
}

export function recommendationSummary(
  recommendation: NimiRuntimeLocalCatalogRecommendation | undefined,
  t: TFunction,
): string {
  return summarizeNimiRuntimeLocalCatalogRecommendation(recommendation, recommendationCopyOptions(t));
}

export function recommendationDetailItems(
  recommendation: NimiRuntimeLocalCatalogRecommendation | undefined,
  t: TFunction,
  options?: {
    maxFallbackEntries?: number;
    includeNote?: boolean;
  },
): NimiRuntimeLocalRecommendationDetailItem[] {
  return buildNimiRuntimeLocalRecommendationDetailItems(recommendation, {
    ...recommendationCopyOptions(t),
    maxFallbackEntries: options?.maxFallbackEntries,
    includeNote: options?.includeNote,
  });
}

export function RecommendationDetailList(props: {
  recommendation: NimiRuntimeLocalCatalogRecommendation | undefined;
  className?: string;
  rowClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  maxFallbackEntries?: number;
  includeNote?: boolean;
}) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const items = recommendationDetailItems(props.recommendation, t, {
    maxFallbackEntries: props.maxFallbackEntries,
    includeNote: props.includeNote,
  });
  if (items.length === 0) {
    return null;
  }
  return (
    <div className={props.className || 'mt-2 space-y-1'}>
      {items.map((item) => (
        <p key={item.key} className={props.rowClassName || 'text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]'}>
          <span className={props.labelClassName || 'font-medium text-[var(--nimi-text-secondary)]'}>{item.label}:</span>{' '}
          <span className={props.valueClassName || ''}>{item.value}</span>
        </p>
      ))}
    </div>
  );
}

export function RecommendationDiagnosticsPanel(props: {
  recommendation: NimiRuntimeLocalCatalogRecommendation | undefined;
  className?: string;
  buttonClassName?: string;
  panelClassName?: string;
}) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
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
        className={props.buttonClassName || 'text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-text-muted)] underline decoration-[color:var(--nimi-border-subtle)] underline-offset-2 hover:text-[var(--nimi-text-secondary)]'}
      >
        {open
          ? t('runtimeConfig.local.recommendationDiagnosticsHide', {
              defaultValue: 'Hide diagnostics',
            })
          : t('runtimeConfig.local.recommendationDiagnosticsShow', {
              defaultValue: 'Show diagnostics',
            })}
      </button>
      {open ? (
        <div className={props.panelClassName || 'mt-2 space-y-2 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]'}>
          <p className="font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.local.recommendationDiagnosticsTitle', {
              defaultValue: 'Recommendation diagnostics',
            })}
          </p>
          <div className="space-y-1">
            <p>
              <span className="font-medium text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.local.recommendationDiagnosticsSource', {
                  defaultValue: 'Source',
                })}
                :
              </span>{' '}
              <span className="font-mono">{recommendation.source}</span>
            </p>
            {recommendation.format ? (
              <p>
                <span className="font-medium text-[var(--nimi-text-primary)]">
                  {t('runtimeConfig.local.recommendationDiagnosticsFormat', {
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
              {t('runtimeConfig.local.recommendationDiagnosticsReasonCodes', {
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
                    <p>{recommendationReasonLabel(reasonCode, t)}</p>
                    <p className="font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{reasonCode}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                {t('runtimeConfig.local.recommendationDiagnosticsNone', {
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
