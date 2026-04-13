import { buildLocalProfileExtensions } from '@nimiplatform/sdk/mod';
import type {
  AgentImageExecutionRuntimeDiagnostics,
  AgentRuntimeResolvedBinding,
} from './chat-agent-runtime-types';
import {
  asArray,
  asRecord,
  normalizeFiniteNumber,
  normalizeOptionalBoolean,
  normalizeOptionalNonNegativeNumber,
  normalizePositiveFiniteNumber,
  normalizeText,
} from './chat-agent-runtime-shared';

const AGENT_CHAT_LOCAL_IMAGE_WORKFLOW_MODEL_ID = 'z_image_turbo';
const AGENT_CHAT_LOCAL_IMAGE_MAIN_ENTRY_ID = 'agent-chat/image-main-model';
const AGENT_CHAT_LOCAL_IMAGE_SLOT_DEFS = [
  { slot: 'vae_path', label: 'VAE', assetKind: 'vae' },
  { slot: 'llm_path', label: 'LLM', assetKind: 'chat' },
  { slot: 'clip_l_path', label: 'CLIP-L', assetKind: 'clip' },
  { slot: 'clip_g_path', label: 'CLIP-G', assetKind: 'clip' },
  { slot: 'controlnet_path', label: 'ControlNet', assetKind: 'controlnet' },
  { slot: 'lora_path', label: 'LoRA', assetKind: 'lora' },
  { slot: 'aux_path', label: 'Auxiliary', assetKind: 'auxiliary' },
] as const;

export function resolveAgentImageRequestConfig(params: Record<string, unknown> | null): {
  responseFormat: 'base64' | 'url' | undefined;
  size: string | undefined;
  seed: number | undefined;
  timeoutMs: number | undefined;
} {
  const normalizedResponseFormat = normalizeText(params?.responseFormat).toLowerCase();
  return {
    responseFormat: normalizedResponseFormat === 'base64' || normalizedResponseFormat === 'url'
      ? normalizedResponseFormat
      : undefined,
    size: normalizeText(params?.size) || undefined,
    seed: normalizeFiniteNumber(params?.seed),
    timeoutMs: normalizePositiveFiniteNumber(params?.timeoutMs),
  };
}

function normalizeLocalImageWorkflowModelId(value: unknown): string {
  let normalized = normalizeText(value).toLowerCase();
  if (normalized.startsWith('media/')) {
    normalized = normalized.slice('media/'.length).trim();
  }
  if (normalized.startsWith('local/')) {
    normalized = normalized.slice('local/'.length).trim();
  }
  return normalized;
}

function isAgentManagedLocalImageWorkflowModel(modelId: string): boolean {
  return /(^|\/)z_image_turbo(?:$|[-_])/u.test(modelId);
}

function resolveLocalImageWorkflowAssetId(value: unknown): string {
  let normalized = normalizeText(value);
  if (normalized.toLowerCase().startsWith('media/')) {
    normalized = normalized.slice('media/'.length).trim();
  }
  return normalized || AGENT_CHAT_LOCAL_IMAGE_WORKFLOW_MODEL_ID;
}

function protoValueToJson(value: unknown): unknown {
  const kind = (value as {
    kind?: Record<string, unknown> & { oneofKind?: string };
  } | undefined)?.kind;
  switch (kind?.oneofKind) {
    case 'boolValue':
      return kind.boolValue;
    case 'numberValue':
      return kind.numberValue;
    case 'stringValue':
      return kind.stringValue;
    case 'structValue':
      return protoStructToJson(kind.structValue);
    case 'listValue':
      return Array.isArray((kind.listValue as { values?: unknown[] } | undefined)?.values)
        ? ((kind.listValue as { values?: unknown[] } | undefined)?.values || []).map((entry) => protoValueToJson(entry))
        : [];
    default:
      return null;
  }
}

function protoStructToJson(value: unknown): Record<string, unknown> | null {
  const fields = (value as { fields?: Record<string, unknown> } | null | undefined)?.fields;
  if (!fields || typeof fields !== 'object') {
    return null;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(fields)) {
    output[key] = protoValueToJson(item);
  }
  return output;
}

export function resolveAgentImageScenarioArtifact(
  response: {
    artifacts?: unknown;
    output?: unknown;
  } | null | undefined,
): Record<string, unknown> | null {
  const hydratedArtifacts = asArray(response?.artifacts)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);
  const hydratedByArtifactId = new Map<string, Record<string, unknown>>();
  for (const artifact of hydratedArtifacts) {
    const artifactId = normalizeText(artifact.artifactId);
    if (artifactId) {
      hydratedByArtifactId.set(artifactId, artifact);
    }
  }

  const output = asRecord(response?.output);
  const outputVariant = asRecord(output?.output);
  const imageGenerate = asRecord(outputVariant?.imageGenerate);
  const typedArtifacts = asArray(imageGenerate?.artifacts)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);

  for (const typedArtifact of typedArtifacts) {
    const artifactId = normalizeText(typedArtifact.artifactId);
    const hydrated = artifactId ? hydratedByArtifactId.get(artifactId) : null;
    const mergedArtifactId = artifactId || normalizeText(hydrated?.artifactId);
    const mergedMimeType = normalizeText(hydrated?.mimeType) || normalizeText(typedArtifact.mimeType);
    if (!mergedArtifactId || !mergedMimeType) {
      continue;
    }
    return {
      ...hydrated,
      ...typedArtifact,
      artifactId: mergedArtifactId,
      mimeType: mergedMimeType,
      bytes: (hydrated?.bytes instanceof Uint8Array ? hydrated.bytes : undefined)
        ?? (typedArtifact.bytes instanceof Uint8Array ? typedArtifact.bytes : undefined),
    };
  }

  return hydratedArtifacts[0] || null;
}

export function parseAgentImageArtifactDiagnostics(value: unknown): AgentImageExecutionRuntimeDiagnostics | null {
  const metadata = asRecord(value);
  if (!metadata) {
    return null;
  }
  const diagnostics: AgentImageExecutionRuntimeDiagnostics = {
    imageJobSubmitMs: null,
    imageLoadMs: normalizeOptionalNonNegativeNumber(metadata.image_load_ms),
    imageGenerateMs: normalizeOptionalNonNegativeNumber(metadata.image_generate_ms),
    artifactHydrateMs: null,
    queueWaitMs: normalizeOptionalNonNegativeNumber(metadata.queue_wait_ms),
    loadCacheHit: normalizeOptionalBoolean(metadata.load_cache_hit),
    residentReused: normalizeOptionalBoolean(metadata.resident_reused),
    residentRestarted: normalizeOptionalBoolean(metadata.resident_restarted),
    queueSerialized: normalizeOptionalBoolean(metadata.queue_serialized),
    profileOverrideStep: normalizeOptionalNonNegativeNumber(metadata.profile_override_step),
    profileOverrideCfgScale: normalizeOptionalNonNegativeNumber(metadata.profile_override_cfg_scale),
    profileOverrideSampler: normalizeText(metadata.profile_override_sampler) || null,
    profileOverrideScheduler: normalizeText(metadata.profile_override_scheduler) || null,
  };
  return Object.values(diagnostics).some((entry) => entry !== null) ? diagnostics : null;
}

export function parseAgentImageArtifactProtoDiagnostics(value: unknown): AgentImageExecutionRuntimeDiagnostics | null {
  return parseAgentImageArtifactDiagnostics(protoStructToJson(value));
}

function shouldInjectAgentLocalImageWorkflow(resolved: AgentRuntimeResolvedBinding): boolean {
  if (resolved.source !== 'local') {
    return false;
  }
  const normalizedModel = normalizeLocalImageWorkflowModelId(
    resolved.modelId || resolved.model || resolved.localModelId,
  );
  if (!isAgentManagedLocalImageWorkflowModel(normalizedModel)) {
    return false;
  }
  const engine = normalizeText(resolved.engine || resolved.provider).toLowerCase();
  return !engine || engine === 'media' || engine === 'local';
}

export function buildAgentLocalImageWorkflowExtensions(input: {
  resolved: AgentRuntimeResolvedBinding;
  params: Record<string, unknown> | null;
}): Record<string, unknown> | undefined {
  if (!shouldInjectAgentLocalImageWorkflow(input.resolved)) {
    return undefined;
  }
  const companionSlots = asRecord(input.params?.companionSlots) || {};
  const entryOverrides = AGENT_CHAT_LOCAL_IMAGE_SLOT_DEFS
    .map((definition) => ({
      definition,
      localAssetId: normalizeText(companionSlots[definition.slot]),
    }))
    .filter((item) => item.localAssetId)
    .map((item) => ({
      entryId: `agent-chat/image-slot/${item.definition.slot}`,
      localAssetId: item.localAssetId,
    }));
  const mainLocalAssetId = normalizeText(
    input.resolved.goRuntimeLocalModelId || input.resolved.localModelId,
  );
  if (mainLocalAssetId) {
    entryOverrides.unshift({
      entryId: AGENT_CHAT_LOCAL_IMAGE_MAIN_ENTRY_ID,
      localAssetId: mainLocalAssetId,
    });
  }

  const profileOverrides: Record<string, unknown> = {};
  const step = normalizePositiveFiniteNumber(input.params?.steps);
  if (step !== undefined) {
    profileOverrides.step = step;
  }
  const cfgScale = normalizePositiveFiniteNumber(input.params?.cfgScale);
  if (cfgScale !== undefined) {
    profileOverrides.cfg_scale = cfgScale;
  }
  const sampler = normalizeText(input.params?.sampler);
  if (sampler) {
    profileOverrides.sampler = sampler;
  }
  const scheduler = normalizeText(input.params?.scheduler);
  if (scheduler) {
    profileOverrides.scheduler = scheduler;
  }
  const options = String(input.params?.optionsText || '')
    .split(/\r?\n/gu)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  if (options.length > 0) {
    profileOverrides.options = options;
  }

  const extensions = buildLocalProfileExtensions({
    entryOverrides,
    profileOverrides,
  });
  extensions.profile_entries = [
    {
      entryId: AGENT_CHAT_LOCAL_IMAGE_MAIN_ENTRY_ID,
      kind: 'asset',
      capability: 'image',
      title: 'Selected local image model',
      required: true,
      preferred: true,
      assetId: resolveLocalImageWorkflowAssetId(input.resolved.modelId || input.resolved.model),
      assetKind: 'image',
    },
    ...AGENT_CHAT_LOCAL_IMAGE_SLOT_DEFS
      .map((definition) => ({
        definition,
        localAssetId: normalizeText(companionSlots[definition.slot]),
      }))
      .filter((item) => item.localAssetId)
      .map((item) => ({
        entryId: `agent-chat/image-slot/${item.definition.slot}`,
        kind: 'asset',
        capability: 'image',
        title: `Workflow slot ${item.definition.slot}`,
        required: true,
        preferred: true,
        assetId: item.definition.slot,
        assetKind: item.definition.assetKind,
        engineSlot: item.definition.slot,
      })),
  ];
  return extensions;
}

export const AGENT_CHAT_IMAGE_EXTENSION_NAMESPACE = 'nimi.scenario.image.request';
