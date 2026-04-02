import { useState } from 'react';
import type {
  LocalRuntimeAssetKind,
  LocalRuntimeAssetRecord,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeVerifiedAssetDescriptor,
} from '@runtime/local-runtime';
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

export const ASSET_KIND_OPTIONS = [
  'vae',
  'clip',
  'controlnet',
  'lora',
  'auxiliary',
] as const satisfies readonly LocalRuntimeAssetKind[];

export const ALL_ASSET_KIND_OPTIONS = [
  'chat',
  'image',
  'video',
  'tts',
  'stt',
  'vae',
  'clip',
  'controlnet',
  'lora',
  'auxiliary',
] as const satisfies readonly LocalRuntimeAssetKind[];

export function formatAssetKindLabel(value: LocalRuntimeAssetKind): string {
  switch (value) {
    case 'chat':
      return 'Chat';
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'tts':
      return 'TTS';
    case 'stt':
      return 'STT';
    case 'vae':
      return 'VAE';
    case 'clip':
      return 'CLIP';
    case 'controlnet':
      return 'ControlNet';
    case 'lora':
      return 'LoRA';
    case 'auxiliary':
      return 'Auxiliary';
    default:
      return value;
  }
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

const ASSET_KIND_RANK: Partial<Record<LocalRuntimeAssetKind, number>> = {
  chat: 0,
  image: 1,
  video: 2,
  tts: 3,
  stt: 4,
  vae: 10,
  clip: 11,
  controlnet: 12,
  lora: 13,
  auxiliary: 14,
};

export function sortVerifiedPassiveAssetsForDisplay(
  assets: LocalRuntimeVerifiedAssetDescriptor[],
): LocalRuntimeVerifiedAssetDescriptor[] {
  return [...assets].sort((left, right) => {
    const leftRecommended = isRecommendedDescriptor(left.tags);
    const rightRecommended = isRecommendedDescriptor(right.tags);
    if (leftRecommended !== rightRecommended) {
      return leftRecommended ? -1 : 1;
    }
    const leftKindRank = ASSET_KIND_RANK[left.kind] ?? Number.MAX_SAFE_INTEGER;
    const rightKindRank = ASSET_KIND_RANK[right.kind] ?? Number.MAX_SAFE_INTEGER;
    if (leftKindRank !== rightKindRank) {
      return leftKindRank - rightKindRank;
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
  if (value === 'supported_supervised') return 'Managed';
  if (value === 'attached_only') return 'Attached Only';
  if (value === 'unsupported') return 'Unsupported';
  return 'Host Unknown';
}

export function recommendationConfidenceLabel(
  value?: LocalRuntimeCatalogRecommendation['confidence'],
): string {
  if (value === 'high') return 'High confidence';
  if (value === 'medium') return 'Medium confidence';
  if (value === 'low') return 'Low confidence';
  return 'Unscored';
}

export function recommendationBaselineLabel(
  value?: LocalRuntimeCatalogRecommendation['baseline'],
): string {
  if (value === 'image-default-v1') {
    return i18n.t('runtimeConfig.local.baselineImageDefault', {
      defaultValue: 'image-default-v1 (1024x1024 text-to-image)',
    });
  }
  if (value === 'video-default-v1') {
    return i18n.t('runtimeConfig.local.baselineVideoDefault', {
      defaultValue: 'video-default-v1 (720p, 4s, 16fps text-to-video)',
    });
  }
  return '-';
}

function recommendationWorkloadLabel(
  recommendation: LocalRuntimeCatalogRecommendation,
): string {
  if (recommendation.source === 'llmfit') {
    if (recommendation.reasonCodes.includes('llmfit_vision_model')) {
      return i18n.t('runtimeConfig.local.recommendationWorkloadVision', {
        defaultValue: 'vision chat',
      });
    }
    return i18n.t('runtimeConfig.local.recommendationWorkloadChat', {
      defaultValue: 'local chat',
    });
  }
  if (recommendation.baseline === 'video-default-v1') {
    return i18n.t('runtimeConfig.local.recommendationWorkloadVideo', {
      defaultValue: 'video generation',
    });
  }
  return i18n.t('runtimeConfig.local.recommendationWorkloadImage', {
    defaultValue: 'image generation',
  });
}

function recommendationTierSummary(
  recommendation: LocalRuntimeCatalogRecommendation,
): string {
  const workload = recommendationWorkloadLabel(recommendation);
  if (recommendation.tier === 'recommended') {
    return i18n.t('runtimeConfig.local.recommendationSummaryRecommended', {
      workload,
      defaultValue: 'Good fit for {{workload}} on this machine.',
    });
  }
  if (recommendation.tier === 'runnable') {
    return i18n.t('runtimeConfig.local.recommendationSummaryRunnable', {
      workload,
      defaultValue: 'Should run for {{workload}}, but with less headroom.',
    });
  }
  if (recommendation.tier === 'tight') {
    return i18n.t('runtimeConfig.local.recommendationSummaryTight', {
      workload,
      defaultValue: 'Likely to run {{workload}}, but memory will be tight.',
    });
  }
  if (recommendation.tier === 'not_recommended') {
    return i18n.t('runtimeConfig.local.recommendationSummaryNotRecommended', {
      workload,
      defaultValue: 'Not a good fit for {{workload}} on this machine.',
    });
  }
  return '';
}

export function recommendationReasonLabel(code: string): string {
  switch (String(code || '').trim()) {
    case 'baseline_image_default_v1':
      return i18n.t('runtimeConfig.local.recommendationReasonBaselineImageDefaultV1', {
        defaultValue: 'Scored against the default image workload baseline.',
      });
    case 'baseline_video_default_v1':
      return i18n.t('runtimeConfig.local.recommendationReasonBaselineVideoDefaultV1', {
        defaultValue: 'Scored against the default video workload baseline.',
      });
    case 'engine_overhead_applied':
      return i18n.t('runtimeConfig.local.recommendationReasonEngineOverheadApplied', {
        defaultValue: 'Engine runtime overhead was included in the estimate.',
      });
    case 'hard_prerequisite_overhead_applied':
      return i18n.t('runtimeConfig.local.recommendationReasonHardPrerequisiteOverheadApplied', {
        defaultValue: 'Required supporting model overhead was included in the estimate.',
      });
    case 'gpu_memory_unknown':
      return i18n.t('runtimeConfig.local.recommendationReasonGpuMemoryUnknown', {
        defaultValue: 'GPU memory could not be measured directly.',
      });
    case 'host_attached_only':
      return i18n.t('runtimeConfig.local.recommendationReasonHostAttachedOnly', {
        defaultValue: 'This engine is only supported through an attached endpoint here.',
      });
    case 'host_unsupported':
      return i18n.t('runtimeConfig.local.recommendationReasonHostUnsupported', {
        defaultValue: 'This engine is not supported on the current host.',
      });
    case 'main_size_unknown':
      return i18n.t('runtimeConfig.local.recommendationReasonMainSizeUnknown', {
        defaultValue: 'The runnable asset size was unavailable, so the estimate is conservative.',
      });
    case 'metadata_incomplete':
      return i18n.t('runtimeConfig.local.recommendationReasonMetadataIncomplete', {
        defaultValue: 'Catalog metadata was incomplete, so confidence was reduced.',
      });
    case 'memory_budget_exceeded':
      return i18n.t('runtimeConfig.local.recommendationReasonMemoryBudgetExceeded', {
        defaultValue: 'The estimated workload exceeds available memory budget.',
      });
    case 'memory_headroom_recommended':
      return i18n.t('runtimeConfig.local.recommendationReasonMemoryHeadroomRecommended', {
        defaultValue: 'Available memory leaves comfortable headroom.',
      });
    case 'memory_headroom_runnable':
      return i18n.t('runtimeConfig.local.recommendationReasonMemoryHeadroomRunnable', {
        defaultValue: 'Available memory is enough, but with limited headroom.',
      });
    case 'memory_headroom_tight':
      return i18n.t('runtimeConfig.local.recommendationReasonMemoryHeadroomTight', {
        defaultValue: 'The model may fit, but memory headroom is tight.',
      });
    case 'safetensors_repo_level_estimate':
      return i18n.t('runtimeConfig.local.recommendationReasonSafetensorsRepoLevelEstimate', {
        defaultValue: 'SafeTensors scoring used a repo-level estimate.',
      });
    case 'unified_memory_estimate':
      return i18n.t('runtimeConfig.local.recommendationReasonUnifiedMemoryEstimate', {
        defaultValue: 'The estimate used unified memory instead of discrete VRAM.',
      });
    case 'variant_quant_parsed':
      return i18n.t('runtimeConfig.local.recommendationReasonVariantQuantParsed', {
        defaultValue: 'Quantization details were inferred from the variant filename.',
      });
    case 'llmfit_cpu_only':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitCpuOnly', {
        defaultValue: 'This model is expected to run on CPU only.',
      });
    case 'llmfit_cpu_offload':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitCpuOffload', {
        defaultValue: 'This model is expected to rely on CPU offload.',
      });
    case 'llmfit_gpu_path':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitGpuPath', {
        defaultValue: 'This model is expected to use the GPU path.',
      });
    case 'llmfit_marginal':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitMarginal', {
        defaultValue: 'LLM fit is marginal on this machine.',
      });
    case 'llmfit_moe_offload':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitMoeOffload', {
        defaultValue: 'This model is expected to use MoE offload.',
      });
    case 'llmfit_params_from_filename':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitParamsFromFilename', {
        defaultValue: 'Model parameter size was inferred from the filename.',
      });
    case 'llmfit_params_from_filesize':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitParamsFromFilesize', {
        defaultValue: 'Model parameter size was estimated from the file size.',
      });
    case 'llmfit_quant_from_filename':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitQuantFromFilename', {
        defaultValue: 'Quantization was inferred from the filename.',
      });
    case 'llmfit_recommended':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitRecommended', {
        defaultValue: 'LLM fit indicates strong runtime headroom.',
      });
    case 'llmfit_runnable':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitRunnable', {
        defaultValue: 'LLM fit indicates the model should run with reduced headroom.',
      });
    case 'llmfit_tight':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitTight', {
        defaultValue: 'LLM fit indicates a tight runtime budget.',
      });
    case 'llmfit_context_defaulted':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitContextDefaulted', {
        defaultValue: 'Context size was estimated from the default baseline.',
      });
    case 'llmfit_vision_model':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitVisionModel', {
        defaultValue: 'The model was treated as a vision-capable chat model.',
      });
    case 'llmfit_tps_estimated':
      return i18n.t('runtimeConfig.local.recommendationReasonLlmfitTpsEstimated', {
        defaultValue: 'Token throughput was estimated heuristically.',
      });
    default:
      return code;
  }
}

export function recommendationSummary(
  recommendation: LocalRuntimeCatalogRecommendation | undefined,
): string {
  if (!recommendation) {
    return '';
  }
  const parts: string[] = [];
  const tierSummary = recommendationTierSummary(recommendation);
  if (tierSummary) {
    parts.push(tierSummary);
  }
  if (recommendation.hostSupportClass === 'attached_only') {
    parts.push(i18n.t('runtimeConfig.local.recommendationSummaryAttached', {
      defaultValue: 'Requires an attached endpoint for this engine.',
    }));
  } else if (recommendation.hostSupportClass === 'unsupported') {
    parts.push(i18n.t('runtimeConfig.local.recommendationSummaryUnsupported', {
      defaultValue: 'Managed host support is unavailable on this machine.',
    }));
  }
  if (recommendation.recommendedEntry) {
    parts.push(i18n.t('runtimeConfig.local.recommendationSummaryVariant', {
      entry: recommendation.recommendedEntry,
      defaultValue: 'Best variant: {{entry}}.',
    }));
  }
  if (recommendation.baseline) {
    parts.push(i18n.t('runtimeConfig.local.recommendationSummaryBaseline', {
      baseline: recommendationBaselineLabel(recommendation.baseline),
      defaultValue: 'Assessed with {{baseline}}.',
    }));
  }
  if (parts.length > 0) {
    return parts.join(' ');
  }

  const firstNote = recommendation.suggestedNotes.find((item) => item.trim());
  if (firstNote) {
    return firstNote;
  }
  const firstReasonCode = recommendation.reasonCodes.find((item) => item.trim());
  if (firstReasonCode) {
    return recommendationReasonLabel(firstReasonCode);
  }
  return '';
}

export type RecommendationDetailItem = {
  key: string;
  label: string;
  value: string;
};

function recommendationFallbackEntriesLabel(
  entries: string[],
  maxEntries: number,
): string {
  const filtered = entries.map((item) => item.trim()).filter(Boolean);
  if (filtered.length <= maxEntries) {
    return filtered.join(', ');
  }
  return i18n.t('runtimeConfig.local.recommendationDetailMoreEntries', {
    entries: filtered.slice(0, maxEntries).join(', '),
    count: filtered.length - maxEntries,
    defaultValue: '{{entries}} +{{count}} more',
  });
}

export function recommendationDetailItems(
  recommendation: LocalRuntimeCatalogRecommendation | undefined,
  options?: {
    maxFallbackEntries?: number;
    includeNote?: boolean;
  },
): RecommendationDetailItem[] {
  if (!recommendation) {
    return [];
  }
  const maxFallbackEntries = options?.maxFallbackEntries ?? 2;
  const includeNote = options?.includeNote ?? true;
  const items: RecommendationDetailItem[] = [];
  if (recommendation.recommendedEntry) {
    items.push({
      key: 'recommendedEntry',
      label: i18n.t('runtimeConfig.local.recommendationDetailRecommendedEntry', {
        defaultValue: 'Recommended entry',
      }),
      value: recommendation.recommendedEntry,
    });
  }
  const fallbackEntries = recommendation.fallbackEntries
    .map((item) => item.trim())
    .filter(Boolean);
  if (fallbackEntries.length > 0) {
    items.push({
      key: 'fallbackEntries',
      label: i18n.t('runtimeConfig.local.recommendationDetailFallbackEntries', {
        defaultValue: 'Fallback entries',
      }),
      value: recommendationFallbackEntriesLabel(fallbackEntries, maxFallbackEntries),
    });
  }
  if (recommendation.baseline) {
    items.push({
      key: 'baseline',
      label: i18n.t('runtimeConfig.local.recommendationDetailBaseline', {
        defaultValue: 'Baseline',
      }),
      value: recommendationBaselineLabel(recommendation.baseline),
    });
  }
  const firstNote = includeNote
    ? recommendation.suggestedNotes.find((item) => item.trim())
    : undefined;
  if (firstNote) {
    items.push({
      key: 'note',
      label: i18n.t('runtimeConfig.local.recommendationDetailNote', {
        defaultValue: 'Note',
      }),
      value: firstNote,
    });
  }
  return items;
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
