import { buildLocalProfileExtensions } from '@nimiplatform/sdk/mod';
import {
  IMAGE_WORKFLOW_PRESET_SELECTIONS,
  type ImageWorkflowDraftState,
  type ImageWorkflowPresetSelectionKey,
} from '../tester-types.js';
import { asString } from '../tester-utils.js';

export const PRESET_LABELS: Record<ImageWorkflowPresetSelectionKey, string> = {
  vaeModel: 'VAE',
  llmModel: 'LLM / Text Encoder',
  clipLModel: 'CLIP-L',
  clipGModel: 'CLIP-G',
  controlnetModel: 'ControlNet',
  loraModel: 'LoRA',
  auxiliaryModel: 'Auxiliary',
};

export function buildProfileOverrides(input: {
  step: string; cfgScale: string; sampler: string; scheduler: string;
  optionsText: string; rawJsonText: string;
}): { overrides: Record<string, unknown> | undefined; error: string } {
  const overrides: Record<string, unknown> = {};
  const step = Number(input.step);
  if (input.step && Number.isFinite(step) && step > 0) overrides.steps = step;
  const cfgScale = Number(input.cfgScale);
  if (input.cfgScale && Number.isFinite(cfgScale)) overrides.cfg_scale = cfgScale;
  if (asString(input.sampler)) overrides.sampler = asString(input.sampler);
  if (asString(input.scheduler)) overrides.scheduler = asString(input.scheduler);
  if (asString(input.optionsText)) {
    for (const line of input.optionsText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separatorIdx = trimmed.indexOf(':');
      if (separatorIdx < 1) {
        overrides[trimmed] = true;
        continue;
      }
      const key = trimmed.slice(0, separatorIdx).trim();
      const val = trimmed.slice(separatorIdx + 1).trim();
      overrides[key] = val === 'true' ? true : val === 'false' ? false : val;
    }
  }
  if (asString(input.rawJsonText)) {
    try {
      const parsed = JSON.parse(input.rawJsonText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(overrides, parsed);
      }
    } catch {
      return { overrides: undefined, error: 'Invalid JSON in profile overrides.' };
    }
  }
  return { overrides: Object.keys(overrides).length > 0 ? overrides : undefined, error: '' };
}

const TESTER_IMAGE_MAIN_ENTRY_ID = 'tester/image-main-model';

export function buildWorkflowExtensions(input: {
  draft: ImageWorkflowDraftState;
  profileOverrides: Record<string, unknown> | undefined;
  mainLocalAssetId: string;
  mainAssetId: string;
}): { extensions: Record<string, unknown> | undefined; error: string } {
  const { draft, profileOverrides, mainLocalAssetId, mainAssetId } = input;
  const entryOverrides: Array<{ entryId: string; localAssetId: string }> = [];
  if (mainLocalAssetId) {
    entryOverrides.push({ entryId: TESTER_IMAGE_MAIN_ENTRY_ID, localAssetId: mainLocalAssetId });
  }
  for (const preset of IMAGE_WORKFLOW_PRESET_SELECTIONS) {
    const val = draft[preset.key];
    if (asString(val)) {
      entryOverrides.push({ entryId: `tester/image-slot/${preset.slot}`, localAssetId: val });
    }
  }
  for (const comp of draft.componentDrafts) {
    if (asString(comp.slot) && asString(comp.localArtifactId)) {
      entryOverrides.push({ entryId: `tester/image-slot/${comp.slot}`, localAssetId: comp.localArtifactId });
    }
  }
  if (entryOverrides.length === 0 && !profileOverrides) {
    return { extensions: undefined, error: '' };
  }
  const extensions = buildLocalProfileExtensions({
    entryOverrides,
    profileOverrides: profileOverrides || {},
  });
  const companionProfileEntries = IMAGE_WORKFLOW_PRESET_SELECTIONS
    .filter((preset) => asString(draft[preset.key]))
    .map((preset) => ({
      entryId: `tester/image-slot/${preset.slot}`,
      kind: 'asset',
      capability: 'image',
      title: `Workflow slot ${preset.slot}`,
      required: true,
      preferred: true,
      assetId: preset.slot,
      assetKind: preset.kind,
      engineSlot: preset.slot,
    }));
  extensions.profile_entries = [
    {
      entryId: TESTER_IMAGE_MAIN_ENTRY_ID,
      kind: 'asset',
      capability: 'image',
      title: 'Selected local image model',
      required: true,
      preferred: true,
      assetId: mainAssetId || mainLocalAssetId,
      assetKind: 'image',
    },
    ...companionProfileEntries,
  ];
  return { extensions, error: '' };
}

export function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatScenarioJobProgress(job: Record<string, unknown> | null | undefined): string {
  const record = job || {};
  const progressPercent = Number(record.progressPercent ?? record.progress);
  const currentStep = Number(record.progressCurrentStep ?? record.progress_current_step);
  const totalSteps = Number(record.progressTotalSteps ?? record.progress_total_steps);
  const parts: string[] = [];
  if (Number.isFinite(progressPercent) && progressPercent >= 0) {
    parts.push(`${Math.round(progressPercent)}%`);
  }
  if (Number.isFinite(currentStep) && currentStep > 0 && Number.isFinite(totalSteps) && totalSteps > 0) {
    parts.push(`${Math.round(currentStep)}/${Math.round(totalSteps)}`);
  }
  return parts.join(' · ');
}
