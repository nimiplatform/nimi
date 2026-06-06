import type {
  LocalRecommendationBaselineId,
  LocalRecommendationCatalogProjection,
  LocalRecommendationConfidenceId,
  LocalRecommendationHostSupportClassId,
} from './local-recommendation-feed.js';

export type LocalRecommendationCopyTranslator = (
  key: string,
  options: { defaultValue: string } & Record<string, string | number>,
) => string;

export type LocalRecommendationCopyOptions = {
  translate?: LocalRecommendationCopyTranslator;
};

export type LocalRecommendationDetailItem = {
  key: string;
  label: string;
  value: string;
};

export type LocalRecommendationDetailOptions = LocalRecommendationCopyOptions & {
  maxFallbackEntries?: number;
  includeNote?: boolean;
};

const LOCAL_RECOMMENDATION_REASON_MESSAGES = Object.freeze({
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

function interpolateDefault(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ));
}

function renderCopy(
  options: LocalRecommendationCopyOptions | undefined,
  key: string,
  defaultValue: string,
  values: Record<string, string | number> = {},
): string {
  if (options?.translate) {
    return options.translate(key, { ...values, defaultValue });
  }
  return interpolateDefault(defaultValue, values);
}

export function formatLocalRecommendationHostSupportLabel(
  value?: LocalRecommendationHostSupportClassId,
): string {
  if (value === 'supported_supervised') return 'Managed';
  if (value === 'attached_only') return 'Attached Only';
  if (value === 'unsupported') return 'Unsupported';
  return 'Host Unknown';
}

export function formatLocalRecommendationConfidenceLabel(
  value?: LocalRecommendationConfidenceId,
): string {
  if (value === 'high') return 'High confidence';
  if (value === 'medium') return 'Medium confidence';
  if (value === 'low') return 'Low confidence';
  return 'Unscored';
}

export function formatLocalRecommendationBaselineLabel(
  value?: LocalRecommendationBaselineId,
  options?: LocalRecommendationCopyOptions,
): string {
  if (value === 'image-default-v1') {
    return renderCopy(options, 'runtimeConfig.local.baselineImageDefault', 'image-default-v1 (1024x1024 text-to-image)');
  }
  if (value === 'video-default-v1') {
    return renderCopy(options, 'runtimeConfig.local.baselineVideoDefault', 'video-default-v1 (720p, 4s, 16fps text-to-video)');
  }
  return '-';
}

function summarizeLocalRecommendationWorkload(
  recommendation: LocalRecommendationCatalogProjection,
  options?: LocalRecommendationCopyOptions,
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

function summarizeLocalRecommendationTier(
  recommendation: LocalRecommendationCatalogProjection,
  options?: LocalRecommendationCopyOptions,
): string {
  const workload = summarizeLocalRecommendationWorkload(recommendation, options);
  if (recommendation.tier === 'recommended') {
    return renderCopy(options, 'runtimeConfig.local.recommendationSummaryRecommended', 'Good fit for {{workload}} on this machine.', { workload });
  }
  if (recommendation.tier === 'runnable') {
    return renderCopy(options, 'runtimeConfig.local.recommendationSummaryRunnable', 'Should run for {{workload}}, but with less headroom.', { workload });
  }
  if (recommendation.tier === 'tight') {
    return renderCopy(options, 'runtimeConfig.local.recommendationSummaryTight', 'Likely to run {{workload}}, but memory will be tight.', { workload });
  }
  if (recommendation.tier === 'not_recommended') {
    return renderCopy(options, 'runtimeConfig.local.recommendationSummaryNotRecommended', 'Not a good fit for {{workload}} on this machine.', { workload });
  }
  return '';
}

export function formatLocalRecommendationReasonLabel(
  code: unknown,
  options?: LocalRecommendationCopyOptions,
): string {
  const normalized = String(code || '').trim();
  const entry = normalized ? LOCAL_RECOMMENDATION_REASON_MESSAGES[normalized as keyof typeof LOCAL_RECOMMENDATION_REASON_MESSAGES] : undefined;
  if (!entry) {
    return normalized;
  }
  return renderCopy(options, entry[0], entry[1]);
}

export function summarizeLocalCatalogRecommendation(
  recommendation: LocalRecommendationCatalogProjection | undefined,
  options?: LocalRecommendationCopyOptions,
): string {
  if (!recommendation) {
    return '';
  }
  const parts: string[] = [];
  const tierSummary = summarizeLocalRecommendationTier(recommendation, options);
  if (tierSummary) {
    parts.push(tierSummary);
  }
  if (recommendation.hostSupportClass === 'attached_only') {
    parts.push(renderCopy(options, 'runtimeConfig.local.recommendationSummaryAttached', 'Requires an attached endpoint for this engine.'));
  } else if (recommendation.hostSupportClass === 'unsupported') {
    parts.push(renderCopy(options, 'runtimeConfig.local.recommendationSummaryUnsupported', 'Managed host support is unavailable on this machine.'));
  }
  if (recommendation.recommendedEntry) {
    parts.push(renderCopy(options, 'runtimeConfig.local.recommendationSummaryVariant', 'Best variant: {{entry}}.', {
      entry: recommendation.recommendedEntry,
    }));
  }
  if (recommendation.baseline) {
    parts.push(renderCopy(options, 'runtimeConfig.local.recommendationSummaryBaseline', 'Assessed with {{baseline}}.', {
      baseline: formatLocalRecommendationBaselineLabel(recommendation.baseline, options),
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
    return formatLocalRecommendationReasonLabel(firstReasonCode, options);
  }
  return '';
}

export function formatLocalRecommendationFallbackEntries(
  entries: readonly unknown[],
  maxEntries: number,
  options?: LocalRecommendationCopyOptions,
): string {
  const filtered = entries.map((item) => String(item || '').trim()).filter(Boolean);
  if (filtered.length <= maxEntries) {
    return filtered.join(', ');
  }
  return renderCopy(options, 'runtimeConfig.local.recommendationDetailMoreEntries', '{{entries}} +{{count}} more', {
    entries: filtered.slice(0, maxEntries).join(', '),
    count: filtered.length - maxEntries,
  });
}

export function buildLocalRecommendationDetailItems(
  recommendation: LocalRecommendationCatalogProjection | undefined,
  options?: LocalRecommendationDetailOptions,
): LocalRecommendationDetailItem[] {
  if (!recommendation) {
    return [];
  }
  const maxFallbackEntries = options?.maxFallbackEntries ?? 2;
  const includeNote = options?.includeNote ?? true;
  const items: LocalRecommendationDetailItem[] = [];
  if (recommendation.recommendedEntry) {
    items.push({
      key: 'recommendedEntry',
      label: renderCopy(options, 'runtimeConfig.local.recommendationDetailRecommendedEntry', 'Recommended entry'),
      value: recommendation.recommendedEntry,
    });
  }
  const fallbackEntries = recommendation.fallbackEntries
    .map((item) => item.trim())
    .filter(Boolean);
  if (fallbackEntries.length > 0) {
    items.push({
      key: 'fallbackEntries',
      label: renderCopy(options, 'runtimeConfig.local.recommendationDetailFallbackEntries', 'Fallback entries'),
      value: formatLocalRecommendationFallbackEntries(fallbackEntries, maxFallbackEntries, options),
    });
  }
  if (recommendation.baseline) {
    items.push({
      key: 'baseline',
      label: renderCopy(options, 'runtimeConfig.local.recommendationDetailBaseline', 'Baseline'),
      value: formatLocalRecommendationBaselineLabel(recommendation.baseline, options),
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
