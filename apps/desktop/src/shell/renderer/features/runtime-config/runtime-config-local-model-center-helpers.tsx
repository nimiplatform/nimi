import { useState } from 'react';
import type {
  LocalRuntimeArtifactKind,
  LocalRuntimeArtifactRecord,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeVerifiedModelDescriptor,
} from '@runtime/local-runtime';
import { formatRelativeLocaleTime, i18n } from '@renderer/i18n';
import { parseTimestamp, type ProgressSessionState } from './runtime-config-model-center-utils';

export const ARTIFACT_KIND_OPTIONS = [
  'vae',
  'llm',
  'clip',
  'controlnet',
  'lora',
  'auxiliary',
] as const satisfies readonly LocalRuntimeArtifactKind[];

export function formatArtifactKindLabel(value: LocalRuntimeArtifactKind): string {
  switch (value) {
    case 'vae':
      return 'VAE';
    case 'llm':
      return 'LLM';
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
  'localai',
  'nexa',
]);

function normalizeDescriptorToken(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

function collectModelFamilyHints(model: LocalRuntimeVerifiedModelDescriptor): string[] {
  const hints = new Set<string>();
  for (const tag of model.tags || []) {
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

export function sortVerifiedModelsForDisplay(
  models: LocalRuntimeVerifiedModelDescriptor[],
): LocalRuntimeVerifiedModelDescriptor[] {
  return [...models].sort((left, right) => {
    const leftRecommended = isRecommendedDescriptor(left.tags);
    const rightRecommended = isRecommendedDescriptor(right.tags);
    if (leftRecommended !== rightRecommended) {
      return leftRecommended ? -1 : 1;
    }
    return compareDescriptorTitles(left.title, left.templateId, right.title, right.templateId);
  });
}

const ARTIFACT_KIND_RANK: Record<LocalRuntimeArtifactKind, number> = {
  vae: 0,
  llm: 1,
  clip: 2,
  controlnet: 3,
  lora: 4,
  auxiliary: 5,
};

export function sortVerifiedArtifactsForDisplay(
  artifacts: LocalRuntimeVerifiedArtifactDescriptor[],
): LocalRuntimeVerifiedArtifactDescriptor[] {
  return [...artifacts].sort((left, right) => {
    const leftRecommended = isRecommendedDescriptor(left.tags);
    const rightRecommended = isRecommendedDescriptor(right.tags);
    if (leftRecommended !== rightRecommended) {
      return leftRecommended ? -1 : 1;
    }
    const leftKindRank = ARTIFACT_KIND_RANK[left.kind] ?? Number.MAX_SAFE_INTEGER;
    const rightKindRank = ARTIFACT_KIND_RANK[right.kind] ?? Number.MAX_SAFE_INTEGER;
    if (leftKindRank !== rightKindRank) {
      return leftKindRank - rightKindRank;
    }
    return compareDescriptorTitles(left.title, left.templateId, right.title, right.templateId);
  });
}

function collectArtifactFamilyHints(artifact: LocalRuntimeVerifiedArtifactDescriptor): string[] {
  const hints = new Set<string>();
  const family = normalizeDescriptorToken(typeof artifact.metadata?.family === 'string' ? artifact.metadata.family : '');
  if (family) {
    hints.add(family);
  }
  for (const tag of artifact.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.has(normalized)) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

export function filterInstalledArtifacts(
  artifacts: LocalRuntimeArtifactRecord[],
  kindFilter: 'all' | LocalRuntimeArtifactKind,
  query: string,
): LocalRuntimeArtifactRecord[] {
  return artifacts.filter((artifact) => {
    const matchesKind = kindFilter === 'all' || artifact.kind === kindFilter;
    if (!matchesKind) return false;
    if (!query) return true;
    return (
      artifact.artifactId.toLowerCase().includes(query)
      || artifact.localArtifactId.toLowerCase().includes(query)
      || artifact.engine.toLowerCase().includes(query)
      || artifact.kind.toLowerCase().includes(query)
      || artifact.source.repo.toLowerCase().includes(query)
    );
  });
}

export function relatedArtifactsForModel(
  model: LocalRuntimeVerifiedModelDescriptor,
  artifacts: LocalRuntimeVerifiedArtifactDescriptor[],
): LocalRuntimeVerifiedArtifactDescriptor[] {
  const capabilities = new Set((model.capabilities || []).map((value) => normalizeDescriptorToken(value)));
  if (!capabilities.has('image')) {
    return [];
  }
  const modelFamilies = new Set(collectModelFamilyHints(model));
  if (modelFamilies.size === 0) {
    return [];
  }
  return artifacts.filter((artifact) => {
    const artifactFamilies = collectArtifactFamilyHints(artifact);
    return artifactFamilies.some((family) => modelFamilies.has(family));
  });
}

export type ArtifactTaskState = 'running' | 'completed' | 'failed';

export type ArtifactTaskEntry = {
  templateId: string;
  artifactId: string;
  title: string;
  kind: LocalRuntimeArtifactKind;
  taskKind: 'verified-install';
  state: ArtifactTaskState;
  detail?: string;
  updatedAtMs: number;
};

export function isArtifactTaskTerminal(state: ArtifactTaskState): boolean {
  return state === 'completed' || state === 'failed';
}

export function artifactTaskStatusLabel(state: ArtifactTaskState): string {
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
  if (value === 'recommended') return 'bg-emerald-100 text-emerald-700';
  if (value === 'runnable') return 'bg-sky-100 text-sky-700';
  if (value === 'tight') return 'bg-amber-100 text-amber-700';
  if (value === 'not_recommended') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-600';
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
        defaultValue: 'The main model size was unavailable, so the estimate is conservative.',
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
        <p key={item.key} className={props.rowClassName || 'text-[11px] text-gray-500'}>
          <span className={props.labelClassName || 'font-medium text-gray-700'}>{item.label}:</span>{' '}
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
        className={props.buttonClassName || 'text-[10px] font-medium text-slate-500 underline decoration-slate-200 underline-offset-2 hover:text-slate-700'}
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
        <div className={props.panelClassName || 'mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-600'}>
          <p className="font-medium text-slate-700">
            {i18n.t('runtimeConfig.local.recommendationDiagnosticsTitle', {
              defaultValue: 'Recommendation diagnostics',
            })}
          </p>
          <div className="space-y-1">
            <p>
              <span className="font-medium text-slate-700">
                {i18n.t('runtimeConfig.local.recommendationDiagnosticsSource', {
                  defaultValue: 'Source',
                })}
                :
              </span>{' '}
              <span className="font-mono">{recommendation.source}</span>
            </p>
            {recommendation.format ? (
              <p>
                <span className="font-medium text-slate-700">
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
            <p className="font-medium text-slate-700">
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
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-600"
                  >
                    <p>{recommendationReasonLabel(reasonCode)}</p>
                    <p className="font-mono text-[10px] text-slate-500">{reasonCode}</p>
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

export function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function HeartPulseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </svg>
  );
}

export function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function PackageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

export function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function FolderOpenIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-mint-500' : 'bg-gray-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function ModelIcon({ engine }: { engine: string }) {
  const colors: Record<string, string> = {
    localai: 'from-emerald-400 to-teal-500',
    nexa: 'from-sky-400 to-cyan-500',
    nimi_media: 'from-rose-400 to-orange-500',
    ollama: 'from-amber-400 to-orange-500',
    llamacpp: 'from-blue-400 to-indigo-500',
    vllm: 'from-purple-400 to-pink-500',
    default: 'from-gray-400 to-gray-500',
  };
  const color = colors[engine.toLowerCase()] || colors.default;

  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${color} text-white text-[10px] font-bold shadow-sm`}>
      {engine.slice(0, 2).toUpperCase()}
    </div>
  );
}

const downloadSessionSnapshotCache: Record<string, ProgressSessionState> = {};

export function getCachedProgressSessions(): Record<string, ProgressSessionState> {
  return { ...downloadSessionSnapshotCache };
}

export function cacheProgressSessions(
  sessions: Record<string, ProgressSessionState>,
): Record<string, ProgressSessionState> {
  for (const sessionId of Object.keys(downloadSessionSnapshotCache)) {
    if (!(sessionId in sessions)) {
      delete downloadSessionSnapshotCache[sessionId];
    }
  }
  Object.assign(downloadSessionSnapshotCache, sessions);
  return sessions;
}
