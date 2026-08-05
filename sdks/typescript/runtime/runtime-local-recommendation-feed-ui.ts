import type {
  NimiRuntimeLocalCatalogRecommendation,
  NimiRuntimeLocalRecommendationBaselineId,
  NimiRuntimeLocalRecommendationConfidenceId,
  NimiRuntimeLocalRecommendationCopyOptions,
  NimiRuntimeLocalRecommendationDetailItem,
  NimiRuntimeLocalRecommendationDetailOptions,
  NimiRuntimeLocalRecommendationFeedCacheStateId,
  NimiRuntimeLocalRecommendationFeedFilters,
  NimiRuntimeLocalRecommendationFeedItemLike,
  NimiRuntimeLocalRecommendationHostSupportClassId,
  NimiRuntimeLocalRecommendationTierId,
} from './runtime-local-recommendation-types';
import {
  parseNimiRuntimeLocalRecommendationFeedCacheStateId,
  parseNimiRuntimeLocalRecommendationTierId,
} from './runtime-local-recommendation';

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_PARAMS_RE = /\b(\d+(?:\.\d+)?)\s*[Bb]\b/;
const NIMI_RUNTIME_LOCAL_RECOMMENDATION_QUANT_LEVEL_RE =
  /\b(F32|F16|BF16|Q[2-8]_[A-Z0-9_]+|Q[2-8]_[0-9]+|IQ[1-4]_[A-Z0-9_]+)\b/i;
const NIMI_RUNTIME_LOCAL_RECOMMENDATION_QUANT_BITS: readonly (readonly [RegExp, number])[] = [
  [/\bF32\b/i, 32],
  [/\bF16\b/i, 16],
  [/\bBF16\b/i, 16],
  [/\bQ8/i, 8],
  [/\bQ6/i, 6],
  [/\bQ5/i, 5],
  [/\bQ4/i, 4],
  [/\bQ3/i, 3],
  [/\bQ2/i, 2],
  [/\bIQ4/i, 4],
  [/\bIQ3/i, 3],
  [/\bIQ2/i, 2],
  [/\bIQ1/i, 1],
];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_REASON_MESSAGES = Object.freeze({
  baseline_image_default_v1: [
    'runtimeConfig.local.recommendationReasonBaselineImageDefaultV1',
    'Scored against the default image workload baseline.',
  ],
  baseline_video_default_v1: [
    'runtimeConfig.local.recommendationReasonBaselineVideoDefaultV1',
    'Scored against the default video workload baseline.',
  ],
  engine_overhead_applied: [
    'runtimeConfig.local.recommendationReasonEngineOverheadApplied',
    'Engine runtime overhead was included in the estimate.',
  ],
  hard_prerequisite_overhead_applied: [
    'runtimeConfig.local.recommendationReasonHardPrerequisiteOverheadApplied',
    'Required supporting model overhead was included in the estimate.',
  ],
  gpu_memory_unknown: [
    'runtimeConfig.local.recommendationReasonGpuMemoryUnknown',
    'GPU memory could not be measured directly.',
  ],
  host_attached_only: [
    'runtimeConfig.local.recommendationReasonHostAttachedOnly',
    'This engine is only supported through an attached endpoint here.',
  ],
  host_unsupported: [
    'runtimeConfig.local.recommendationReasonHostUnsupported',
    'This engine is not supported on the current host.',
  ],
  main_size_unknown: [
    'runtimeConfig.local.recommendationReasonMainSizeUnknown',
    'The runnable asset size was unavailable, so the estimate is conservative.',
  ],
  metadata_incomplete: [
    'runtimeConfig.local.recommendationReasonMetadataIncomplete',
    'Catalog metadata was incomplete, so confidence was reduced.',
  ],
  memory_budget_exceeded: [
    'runtimeConfig.local.recommendationReasonMemoryBudgetExceeded',
    'The estimated workload exceeds available memory budget.',
  ],
  memory_headroom_recommended: [
    'runtimeConfig.local.recommendationReasonMemoryHeadroomRecommended',
    'Available memory leaves comfortable headroom.',
  ],
  memory_headroom_runnable: [
    'runtimeConfig.local.recommendationReasonMemoryHeadroomRunnable',
    'Available memory is enough, but with limited headroom.',
  ],
  memory_headroom_tight: [
    'runtimeConfig.local.recommendationReasonMemoryHeadroomTight',
    'The model may fit, but memory headroom is tight.',
  ],
  safetensors_repo_level_estimate: [
    'runtimeConfig.local.recommendationReasonSafetensorsRepoLevelEstimate',
    'SafeTensors scoring used a repo-level estimate.',
  ],
  unified_memory_estimate: [
    'runtimeConfig.local.recommendationReasonUnifiedMemoryEstimate',
    'The estimate used unified memory instead of discrete VRAM.',
  ],
  variant_quant_parsed: [
    'runtimeConfig.local.recommendationReasonVariantQuantParsed',
    'Quantization details were inferred from the variant filename.',
  ],
  llmfit_cpu_only: [
    'runtimeConfig.local.recommendationReasonLlmfitCpuOnly',
    'This model is expected to run on CPU only.',
  ],
  llmfit_cpu_offload: [
    'runtimeConfig.local.recommendationReasonLlmfitCpuOffload',
    'This model is expected to rely on CPU offload.',
  ],
  llmfit_gpu_path: [
    'runtimeConfig.local.recommendationReasonLlmfitGpuPath',
    'This model is expected to use the GPU path.',
  ],
  llmfit_marginal: [
    'runtimeConfig.local.recommendationReasonLlmfitMarginal',
    'LLM fit is marginal on this machine.',
  ],
  llmfit_moe_offload: [
    'runtimeConfig.local.recommendationReasonLlmfitMoeOffload',
    'This model is expected to use MoE offload.',
  ],
  llmfit_params_from_filename: [
    'runtimeConfig.local.recommendationReasonLlmfitParamsFromFilename',
    'Model parameter size was inferred from the filename.',
  ],
  llmfit_params_from_filesize: [
    'runtimeConfig.local.recommendationReasonLlmfitParamsFromFilesize',
    'Model parameter size was estimated from the file size.',
  ],
  llmfit_quant_from_filename: [
    'runtimeConfig.local.recommendationReasonLlmfitQuantFromFilename',
    'Quantization was inferred from the filename.',
  ],
  llmfit_recommended: [
    'runtimeConfig.local.recommendationReasonLlmfitRecommended',
    'LLM fit indicates strong runtime headroom.',
  ],
  llmfit_runnable: [
    'runtimeConfig.local.recommendationReasonLlmfitRunnable',
    'LLM fit indicates the model should run with reduced headroom.',
  ],
  llmfit_tight: [
    'runtimeConfig.local.recommendationReasonLlmfitTight',
    'LLM fit indicates a tight runtime budget.',
  ],
  llmfit_context_defaulted: [
    'runtimeConfig.local.recommendationReasonLlmfitContextDefaulted',
    'Context size was estimated from the default baseline.',
  ],
  llmfit_vision_model: [
    'runtimeConfig.local.recommendationReasonLlmfitVisionModel',
    'The model was treated as a vision-capable chat model.',
  ],
  llmfit_tps_estimated: [
    'runtimeConfig.local.recommendationReasonLlmfitTpsEstimated',
    'Token throughput was estimated heuristically.',
  ],
} satisfies Record<string, readonly [string, string]>);

export function summarizeNimiRuntimeLocalRecommendationFeedCacheState(
  feed: { readonly cacheState?: unknown } | null | undefined,
): NimiRuntimeLocalRecommendationFeedCacheStateId {
  return parseNimiRuntimeLocalRecommendationFeedCacheStateId(feed?.cacheState) ?? 'empty';
}

export function formatNimiRuntimeLocalRecommendationRepoOwner(repo: unknown): string {
  const org = String(repo ?? '').split('/')[0]?.trim() || '';
  if (!org) {
    return 'Unknown';
  }
  return org
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

export function selectNimiRuntimeLocalRecommendationPrimaryEntrySize(
  item: NimiRuntimeLocalRecommendationFeedItemLike,
): number {
  const entries = item.entries;
  if (!entries || entries.length === 0) {
    return 0;
  }
  const recommended = String(item.recommendation?.recommendedEntry || '').trim();
  if (recommended) {
    const match = entries.find((entry) => entry.entry === recommended);
    if (match) {
      return Number(match.totalSizeBytes || 0);
    }
  }
  return Number(entries[0]?.totalSizeBytes || 0);
}

export function nimiRuntimeLocalRecommendationFeedMatchesQuery(
  item: NimiRuntimeLocalRecommendationFeedItemLike,
  query: unknown,
): boolean {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const fields = [
    item.title,
    item.repo,
    item.description,
    item.installPayload?.modelId,
    item.recommendation?.recommendedEntry,
    ...(item.tags || []),
    ...(item.capabilities || []),
    ...(item.formats || []),
  ];
  return fields.some((value) => String(value || '').toLowerCase().includes(normalized));
}

export function parseNimiRuntimeLocalRecommendationParamsFromTitle(title: unknown): string {
  const match = NIMI_RUNTIME_LOCAL_RECOMMENDATION_PARAMS_RE.exec(String(title ?? ''));
  return match ? `${match[1]}B` : '';
}

export function parseNimiRuntimeLocalRecommendationLicenseShort(license: unknown): string {
  const raw = String(license || '').trim();
  if (!raw || raw === 'unknown') return '';
  const lower = raw.toLowerCase();
  if (lower.includes('apache')) return 'Apache 2.0';
  if (lower.includes('mit')) return 'MIT';
  if (lower.includes('llama 3.1') || lower.includes('llama3.1')) return 'Llama 3.1';
  if (lower.includes('llama 3.3') || lower.includes('llama3.3')) return 'Llama 3.3';
  if (lower.includes('llama 4') || lower.includes('llama4')) return 'Llama 4';
  if (lower.includes('llama')) return 'Llama Community';
  if (lower.includes('gemma')) return 'Gemma';
  if (lower.includes('qwen')) return 'Qwen';
  if (lower.includes('gpl')) return 'GPL';
  if (lower.includes('cc-by')) return 'CC-BY';
  if (lower.includes('creativeml')) return 'CreativeML';
  if (raw.length > 20) return `${raw.slice(0, 18)}...`;
  return raw;
}

export function computeNimiRuntimeLocalRecommendationVramPercentage(
  modelSizeBytes: number,
  totalVramBytes?: number,
): number | null {
  if (!totalVramBytes || totalVramBytes <= 0 || modelSizeBytes <= 0) {
    return null;
  }
  return Math.round((modelSizeBytes / totalVramBytes) * 100);
}

export function filterNimiRuntimeLocalRecommendationFeedItems<T extends NimiRuntimeLocalRecommendationFeedItemLike>(
  items: readonly T[],
  query: unknown,
): T[] {
  return items.filter((item) => nimiRuntimeLocalRecommendationFeedMatchesQuery(item, query));
}

export function applyNimiRuntimeLocalRecommendationFeedFilters<T extends NimiRuntimeLocalRecommendationFeedItemLike>(
  items: readonly T[],
  filters: NimiRuntimeLocalRecommendationFeedFilters,
): T[] {
  return items.filter((item) => {
    if (!nimiRuntimeLocalRecommendationFeedMatchesQuery(item, filters.query)) return false;
    if (filters.providers?.size) {
      const provider = formatNimiRuntimeLocalRecommendationRepoOwner(item.repo);
      if (!filters.providers.has(provider)) return false;
    }
    if (filters.licenses?.size) {
      const license = parseNimiRuntimeLocalRecommendationLicenseShort(item.installPayload?.license);
      if (!license || !filters.licenses.has(license)) return false;
    }
    return true;
  });
}

export function collectNimiRuntimeLocalRecommendationFeedProviders(
  items: readonly NimiRuntimeLocalRecommendationFeedItemLike[],
): string[] {
  const providers = new Set<string>();
  for (const item of items) {
    providers.add(formatNimiRuntimeLocalRecommendationRepoOwner(item.repo));
  }
  return [...providers].sort();
}

export function collectNimiRuntimeLocalRecommendationFeedLicenses(
  items: readonly NimiRuntimeLocalRecommendationFeedItemLike[],
): string[] {
  const licenses = new Set<string>();
  for (const item of items) {
    const label = parseNimiRuntimeLocalRecommendationLicenseShort(item.installPayload?.license);
    if (label) {
      licenses.add(label);
    }
  }
  return [...licenses].sort();
}

export function parseNimiRuntimeLocalRecommendationQuantBitsFromEntry(entry: unknown): number | null {
  const text = String(entry || '');
  for (const [pattern, bits] of NIMI_RUNTIME_LOCAL_RECOMMENDATION_QUANT_BITS) {
    if (pattern.test(text)) {
      return bits;
    }
  }
  return null;
}

export function parseNimiRuntimeLocalRecommendationQuantLevelFromEntry(entry: unknown): string {
  const match = NIMI_RUNTIME_LOCAL_RECOMMENDATION_QUANT_LEVEL_RE.exec(String(entry || ''));
  return match ? match[1]!.toUpperCase() : '';
}

export function formatNimiRuntimeLocalRecommendationQuantQualityLabel(bits: number | null): string {
  if (bits === null) return '';
  if (bits >= 16) return 'Lossless';
  if (bits >= 8) return 'High';
  if (bits >= 5) return 'Medium-High';
  if (bits >= 4) return 'Medium';
  if (bits >= 3) return 'Low-Medium';
  return 'Low';
}

export function buildNimiRuntimeLocalRecommendationHuggingFaceUrl(repo: unknown): string {
  return `https://huggingface.co/${String(repo || '').trim()}`;
}

export function formatNimiRuntimeLocalRecommendationHostSupportLabel(
  value?: NimiRuntimeLocalRecommendationHostSupportClassId,
): string {
  if (value === 'supported_supervised') return 'Managed';
  if (value === 'attached_only') return 'Attached Only';
  if (value === 'unsupported') return 'Unsupported';
  return 'Host Unknown';
}

export function formatNimiRuntimeLocalRecommendationConfidenceLabel(
  value?: NimiRuntimeLocalRecommendationConfidenceId,
): string {
  if (value === 'high') return 'High confidence';
  if (value === 'medium') return 'Medium confidence';
  if (value === 'low') return 'Low confidence';
  return 'Unscored';
}

export function formatNimiRuntimeLocalRecommendationBaselineLabel(
  value?: NimiRuntimeLocalRecommendationBaselineId,
  options?: NimiRuntimeLocalRecommendationCopyOptions,
): string {
  if (value === 'image-default-v1') {
    return renderCopy(options, 'runtimeConfig.local.baselineImageDefault', 'image-default-v1 (1024x1024 text-to-image)');
  }
  if (value === 'video-default-v1') {
    return renderCopy(options, 'runtimeConfig.local.baselineVideoDefault', 'video-default-v1 (720p, 4s, 16fps text-to-video)');
  }
  return '-';
}

export function formatNimiRuntimeLocalRecommendationReasonLabel(
  code: unknown,
  options?: NimiRuntimeLocalRecommendationCopyOptions,
): string {
  const normalized = String(code || '').trim();
  const entry = normalized
    ? NIMI_RUNTIME_LOCAL_RECOMMENDATION_REASON_MESSAGES[
      normalized as keyof typeof NIMI_RUNTIME_LOCAL_RECOMMENDATION_REASON_MESSAGES
    ]
    : undefined;
  if (!entry) {
    return normalized;
  }
  return renderCopy(options, entry[0], entry[1]);
}

export function summarizeNimiRuntimeLocalCatalogRecommendation(
  recommendation: NimiRuntimeLocalCatalogRecommendation | undefined,
  options?: NimiRuntimeLocalRecommendationCopyOptions,
): string {
  if (!recommendation) {
    return '';
  }
  const parts: string[] = [];
  const tierSummary = summarizeNimiRuntimeLocalRecommendationTier(recommendation, options);
  if (tierSummary) {
    parts.push(tierSummary);
  }
  if (recommendation.hostSupportClass === 'attached_only') {
    parts.push(renderCopy(
      options,
      'runtimeConfig.local.recommendationSummaryAttached',
      'Requires an attached endpoint for this engine.',
    ));
  } else if (recommendation.hostSupportClass === 'unsupported') {
    parts.push(renderCopy(
      options,
      'runtimeConfig.local.recommendationSummaryUnsupported',
      'Managed host support is unavailable on this machine.',
    ));
  }
  if (recommendation.recommendedEntry) {
    parts.push(renderCopy(options, 'runtimeConfig.local.recommendationSummaryVariant', 'Best variant: {{entry}}.', {
      entry: recommendation.recommendedEntry,
    }));
  }
  if (recommendation.baseline) {
    parts.push(renderCopy(
      options,
      'runtimeConfig.local.recommendationSummaryBaseline',
      'Assessed with {{baseline}}.',
      { baseline: formatNimiRuntimeLocalRecommendationBaselineLabel(recommendation.baseline, options) },
    ));
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
    return formatNimiRuntimeLocalRecommendationReasonLabel(firstReasonCode, options);
  }
  return '';
}

export function formatNimiRuntimeLocalRecommendationFallbackEntries(
  entries: readonly unknown[],
  maxEntries: number,
  options?: NimiRuntimeLocalRecommendationCopyOptions,
): string {
  const filtered = entries.map((item) => String(item || '').trim()).filter(Boolean);
  if (filtered.length <= maxEntries) {
    return filtered.join(', ');
  }
  return renderCopy(
    options,
    'runtimeConfig.local.recommendationDetailMoreEntries',
    '{{entries}} +{{count}} more',
    {
      entries: filtered.slice(0, maxEntries).join(', '),
      count: filtered.length - maxEntries,
    },
  );
}

export function buildNimiRuntimeLocalRecommendationDetailItems(
  recommendation: NimiRuntimeLocalCatalogRecommendation | undefined,
  options?: NimiRuntimeLocalRecommendationDetailOptions,
): NimiRuntimeLocalRecommendationDetailItem[] {
  if (!recommendation) {
    return [];
  }
  const maxFallbackEntries = options?.maxFallbackEntries ?? 2;
  const includeNote = options?.includeNote ?? true;
  const items: NimiRuntimeLocalRecommendationDetailItem[] = [];
  if (recommendation.recommendedEntry) {
    items.push({
      key: 'recommendedEntry',
      label: renderCopy(options, 'runtimeConfig.local.recommendationDetailRecommendedEntry', 'Recommended entry'),
      value: recommendation.recommendedEntry,
    });
  }
  const fallbackEntries = recommendation.fallbackEntries.map((item) => item.trim()).filter(Boolean);
  if (fallbackEntries.length > 0) {
    items.push({
      key: 'fallbackEntries',
      label: renderCopy(options, 'runtimeConfig.local.recommendationDetailFallbackEntries', 'Fallback entries'),
      value: formatNimiRuntimeLocalRecommendationFallbackEntries(fallbackEntries, maxFallbackEntries, options),
    });
  }
  if (recommendation.baseline) {
    items.push({
      key: 'baseline',
      label: renderCopy(options, 'runtimeConfig.local.recommendationDetailBaseline', 'Baseline'),
      value: formatNimiRuntimeLocalRecommendationBaselineLabel(recommendation.baseline, options),
    });
  }
  const firstNote = includeNote
    ? recommendation.suggestedNotes.find((item) => item.trim())
    : undefined;
  if (firstNote) {
    items.push({
      key: 'note',
      label: renderCopy(options, 'runtimeConfig.local.recommendationDetailNote', 'Note'),
      value: firstNote,
    });
  }
  return items;
}
function summarizeNimiRuntimeLocalRecommendationWorkload(
  recommendation: NimiRuntimeLocalCatalogRecommendation,
  options?: NimiRuntimeLocalRecommendationCopyOptions,
): string {
  if (recommendation.source === 'llmfit') {
    if (recommendation.reasonCodes.includes('llmfit_vision_model')) {
      return renderCopy(options, 'runtimeConfig.local.recommendationWorkloadVision', 'vision chat');
    }
    return renderCopy(options, 'runtimeConfig.local.recommendationWorkloadChat', 'local chat');
  }
  if (recommendation.baseline === 'video-default-v1') {
    return renderCopy(options, 'runtimeConfig.local.recommendationWorkloadVideo', 'video generation');
  }
  return renderCopy(options, 'runtimeConfig.local.recommendationWorkloadImage', 'image generation');
}

function summarizeNimiRuntimeLocalRecommendationTier(
  recommendation: NimiRuntimeLocalCatalogRecommendation,
  options?: NimiRuntimeLocalRecommendationCopyOptions,
): string {
  const workload = summarizeNimiRuntimeLocalRecommendationWorkload(recommendation, options);
  if (recommendation.tier === 'recommended') {
    return renderCopy(
      options,
      'runtimeConfig.local.recommendationSummaryRecommended',
      'Good fit for {{workload}} on this machine.',
      { workload },
    );
  }
  if (recommendation.tier === 'runnable') {
    return renderCopy(
      options,
      'runtimeConfig.local.recommendationSummaryRunnable',
      'Should run for {{workload}}, but with less headroom.',
      { workload },
    );
  }
  if (recommendation.tier === 'tight') {
    return renderCopy(
      options,
      'runtimeConfig.local.recommendationSummaryTight',
      'Likely to run {{workload}}, but memory will be tight.',
      { workload },
    );
  }
  if (recommendation.tier === 'not_recommended') {
    return renderCopy(
      options,
      'runtimeConfig.local.recommendationSummaryNotRecommended',
      'Not a good fit for {{workload}} on this machine.',
      { workload },
    );
  }
  return '';
}

function renderCopy(
  options: NimiRuntimeLocalRecommendationCopyOptions | undefined,
  key: string,
  defaultValue: string,
  values: Record<string, string | number> = {},
): string {
  if (options?.translate) {
    return options.translate(key, { ...values, defaultValue });
  }
  return defaultValue.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, keyName: string) => (
    Object.hasOwn(values, keyName) ? String(values[keyName]) : match
  ));
}
