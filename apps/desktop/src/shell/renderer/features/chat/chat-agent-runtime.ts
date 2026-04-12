import {
  createNimiError,
  ExecutionMode,
  RoutePolicy,
  ScenarioJobStatus,
  ScenarioType,
  toProtoStruct,
  type TextMessage,
  type TextStreamOutput,
} from '@nimiplatform/sdk/runtime';
import type { ConversationRuntimeTextMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import { buildLocalProfileExtensions } from '@nimiplatform/sdk/mod';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { invokeModLlm } from '@runtime/llm-adapter/execution';
import type { InvokeModLlmInput, InvokeModLlmOutput } from '@runtime/llm-adapter/execution';
import {
  buildRuntimeCallOptions,
  buildRuntimeStreamOptions,
  buildRuntimeRequestMetadata,
  ensureRuntimeLocalModelWarm,
  getRuntimeClient,
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  resolveChatThinkingConfig,
  resolveAgentChatThinkingSupport,
  type ChatThinkingPreference,
} from './chat-thinking';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message';
import type { AgentVoiceWorkflowIntent } from './chat-agent-turn-plan';
import type { AgentChatVoiceReferenceMeaning } from './chat-agent-voice-workflow';
import type {
  AgentEffectiveCapabilityResolution,
  AISnapshot,
} from './conversation-capability';

export type ChatAgentRuntimeInvokeInput = {
  agentId: string;
  prompt?: string;
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
  maxOutputTokensRequested?: number | null;
  threadId: string;
  reasoningPreference: ChatThinkingPreference;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  executionSnapshot: AISnapshot | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  signal?: AbortSignal;
};

export type ChatAgentRuntimeInvokeResult = {
  text: string;
  traceId: string;
  promptTraceId: string;
};

export type ChatAgentRuntimeStreamResult = {
  stream: TextStreamOutput['stream'];
  promptTraceId: string;
};

export type ChatAgentImageRuntimeInvokeInput = {
  prompt: string;
  imageExecutionSnapshot: AISnapshot | null;
  imageCapabilityParams?: Record<string, unknown> | null;
  signal?: AbortSignal;
};

export type ChatAgentImageRuntimeInvokeResult = {
  mediaUrl: string;
  mimeType: string;
  artifactId: string | null;
  traceId: string;
  diagnostics?: AgentImageExecutionRuntimeDiagnostics | null;
};

export type AgentImageExecutionRuntimeDiagnostics = {
  imageJobSubmitMs: number | null;
  imageLoadMs: number | null;
  imageGenerateMs: number | null;
  artifactHydrateMs: number | null;
  queueWaitMs: number | null;
  loadCacheHit: boolean | null;
  residentReused: boolean | null;
  residentRestarted: boolean | null;
  queueSerialized: boolean | null;
  profileOverrideStep: number | null;
  profileOverrideCfgScale: number | null;
  profileOverrideSampler: string | null;
  profileOverrideScheduler: string | null;
};

export type ChatAgentVoiceRuntimeInvokeInput = {
  prompt: string;
  voiceExecutionSnapshot: AISnapshot | null;
  signal?: AbortSignal;
};

export type ChatAgentVoiceRuntimeInvokeResult = {
  mediaUrl: string;
  mimeType: string;
  artifactId: string | null;
  traceId: string;
};

export type ChatAgentVoiceWorkflowReferenceAudio = {
  bytes: Uint8Array;
  mimeType: string;
  transcriptText: string;
};

export type ChatAgentVoiceWorkflowSubmitInput = {
  threadId: string;
  turnId: string;
  beatId: string;
  workflowIntent: AgentVoiceWorkflowIntent;
  prompt: string;
  voiceWorkflowExecutionSnapshot: AISnapshot | null;
  referenceAudio?: ChatAgentVoiceWorkflowReferenceAudio | null;
  signal?: AbortSignal;
};

export type ChatAgentVoiceWorkflowSubmitResult = {
  jobId: string;
  traceId: string;
  workflowStatus: 'submitted' | 'queued' | 'running';
  voiceReference: AgentChatVoiceReferenceMeaning | null;
  voiceAssetId: string | null;
  providerVoiceRef: string | null;
};

export type ChatAgentVoiceWorkflowPollResult = {
  workflowStatus: 'submitted' | 'queued' | 'running' | 'complete' | 'failed' | 'canceled';
  traceId: string | null;
  message: string | null;
};

export type ChatAgentVoiceReferenceSynthesisInput = {
  prompt: string;
  voiceReference: AgentChatVoiceReferenceMeaning;
  voiceExecutionSnapshot: AISnapshot | null;
  signal?: AbortSignal;
};

export type ChatAgentTranscribeRuntimeInvokeInput = {
  audioBytes: Uint8Array;
  mimeType: string;
  transcribeExecutionSnapshot: AISnapshot | null;
  language?: string;
  signal?: AbortSignal;
};

export type ChatAgentTranscribeRuntimeInvokeResult = {
  text: string;
  traceId: string;
};

export type ChatAgentImageRuntimeInvokeDeps = {
  buildRuntimeRequestMetadataImpl?: typeof buildRuntimeRequestMetadata;
  buildRuntimeCallOptionsImpl?: typeof buildRuntimeCallOptions;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ChatAgentVoiceRuntimeInvokeDeps = {
  buildRuntimeRequestMetadataImpl?: typeof buildRuntimeRequestMetadata;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ChatAgentVoiceWorkflowRuntimeDeps = {
  buildRuntimeCallOptionsImpl?: typeof buildRuntimeCallOptions;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ChatAgentTranscribeRuntimeInvokeDeps = {
  buildRuntimeRequestMetadataImpl?: typeof buildRuntimeRequestMetadata;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ChatAgentRuntimeInvokeDeps = {
  invokeModLlmImpl?: (input: InvokeModLlmInput) => Promise<InvokeModLlmOutput>;
  resolveInvokeInputImpl?: (input: ChatAgentRuntimeInvokeInput) => Promise<InvokeModLlmInput>;
};

type ResolvedAgentRuntimeRouteInput = {
  modId: string;
  provider: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
};

export type ChatAgentRuntimeStreamDeps = {
  resolveRouteInputImpl?: (input: ChatAgentRuntimeInvokeInput) => Promise<ResolvedAgentRuntimeRouteInput>;
  buildRuntimeStreamOptionsImpl?: typeof buildRuntimeStreamOptions;
  ensureRuntimeLocalModelWarmImpl?: typeof ensureRuntimeLocalModelWarm;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export const CORE_CHAT_AGENT_MOD_ID = 'core.chat-agent';
const AGENT_CHAT_LOCAL_IMAGE_WORKFLOW_MODEL_ID = 'z_image_turbo';
const AGENT_CHAT_LOCAL_IMAGE_MAIN_ENTRY_ID = 'agent-chat/image-main-model';
const AGENT_CHAT_IMAGE_EXTENSION_NAMESPACE = 'nimi.scenario.image.request';
const AGENT_CHAT_LOCAL_IMAGE_SLOT_DEFS = [
  { slot: 'vae_path', label: 'VAE', assetKind: 'vae' },
  { slot: 'llm_path', label: 'LLM', assetKind: 'chat' },
  { slot: 'clip_l_path', label: 'CLIP-L', assetKind: 'clip' },
  { slot: 'clip_g_path', label: 'CLIP-G', assetKind: 'clip' },
  { slot: 'controlnet_path', label: 'ControlNet', assetKind: 'controlnet' },
  { slot: 'lora_path', label: 'LoRA', assetKind: 'lora' },
  { slot: 'aux_path', label: 'Auxiliary', assetKind: 'auxiliary' },
] as const;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requirePrompt(value: unknown): string {
  const prompt = normalizeText(value);
  if (!prompt) {
    throw createNimiError({
      message: 'agent text prompt is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_text_prompt',
      source: 'runtime',
    });
  }
  return prompt;
}

function toSdkTextMessage(message: ConversationRuntimeTextMessage): TextMessage {
  return {
    role: message.role,
    content: message.content ?? message.text,
    name: normalizeText(message.name) || undefined,
  };
}

function resolveRuntimeTextInput(input: ChatAgentRuntimeInvokeInput): string | TextMessage[] {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return input.messages.map((message) => toSdkTextMessage(message));
  }
  return requirePrompt(input.prompt);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function normalizePositiveFiniteNumber(value: unknown): number | undefined {
  const normalized = normalizeFiniteNumber(value);
  return normalized && normalized > 0 ? normalized : undefined;
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

function resolveAgentImageResponseFormat(value: unknown): 'base64' | 'url' | undefined {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'base64' || normalized === 'url'
    ? normalized
    : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function protoValueToJson(value: unknown): unknown {
  const kind = (value as {
    kind?: Record<string, unknown> & { oneofKind?: string };
  } | undefined)?.kind;
  switch (kind?.oneofKind) {
    case 'boolValue':
      return kind['boolValue'];
    case 'numberValue':
      return kind['numberValue'];
    case 'stringValue':
      return kind['stringValue'];
    case 'structValue':
      return protoStructToJson(kind['structValue']);
    case 'listValue':
      return Array.isArray((kind['listValue'] as { values?: unknown[] } | undefined)?.values)
        ? ((kind['listValue'] as { values?: unknown[] } | undefined)?.values || []).map((entry: unknown) => protoValueToJson(entry))
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function resolveAgentImageScenarioArtifact(
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

function parseAgentImageArtifactDiagnostics(value: unknown): AgentImageExecutionRuntimeDiagnostics | null {
  const metadata = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

function shouldInjectAgentLocalImageWorkflow(resolved: NonNullable<import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding']>): boolean {
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

function buildAgentLocalImageWorkflowExtensions(input: {
  resolved: NonNullable<import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding']>;
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

function requireValue(value: unknown, reasonCode: string, actionHint: string, message: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message,
      reasonCode,
      actionHint,
      source: 'runtime',
    });
  }
  return normalized;
}

function resolveExecutionSlice(
  snapshot: AISnapshot | null | undefined,
  capability:
    | 'text.generate'
    | 'image.generate'
    | 'audio.synthesize'
    | 'audio.transcribe'
    | 'voice_workflow.tts_v2v'
    | 'voice_workflow.tts_t2v',
): NonNullable<AISnapshot['conversationCapabilitySlice']> {
  const slice = snapshot?.conversationCapabilitySlice;
  if (!slice || slice.capability !== capability || !slice.resolvedBinding) {
    throw createNimiError({
      message: `${capability} execution snapshot is not available`,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  return slice;
}

function encodeBytesAsDataUrl(mimeType: string, bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function toRuntimeRoutePolicy(source: string): RoutePolicy {
  return source === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD;
}

function resolveWorkflowJobStatus(status: number): ChatAgentVoiceWorkflowPollResult['workflowStatus'] {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'submitted';
    case ScenarioJobStatus.QUEUED:
      return 'queued';
    case ScenarioJobStatus.RUNNING:
      return 'running';
    case ScenarioJobStatus.COMPLETED:
      return 'complete';
    case ScenarioJobStatus.CANCELED:
      return 'canceled';
    case ScenarioJobStatus.FAILED:
    case ScenarioJobStatus.TIMEOUT:
      return 'failed';
    default:
      return 'submitted';
  }
}

function toRuntimeVoiceReference(
  reference: AgentChatVoiceReferenceMeaning,
): {
  kind: number;
  reference:
    | { oneofKind: 'presetVoiceId'; presetVoiceId: string }
    | { oneofKind: 'voiceAssetId'; voiceAssetId: string }
    | { oneofKind: 'providerVoiceRef'; providerVoiceRef: string };
} {
  if (reference.kind === 'preset_voice_id') {
    return {
      kind: 1,
      reference: {
        oneofKind: 'presetVoiceId',
        presetVoiceId: reference.stableRef,
      },
    };
  }
  if (reference.kind === 'voice_asset_id') {
    return {
      kind: 2,
      reference: {
        oneofKind: 'voiceAssetId',
        voiceAssetId: reference.stableRef,
      },
    };
  }
  return {
    kind: 3,
    reference: {
      oneofKind: 'providerVoiceRef',
      providerVoiceRef: reference.stableRef,
    },
  };
}

function resolveVoiceReferenceFromAsset(
  asset: { voiceAssetId?: unknown; providerVoiceRef?: unknown } | null | undefined,
): {
  voiceReference: AgentChatVoiceReferenceMeaning | null;
  voiceAssetId: string | null;
  providerVoiceRef: string | null;
} {
  const voiceAssetId = normalizeText(asset?.voiceAssetId) || null;
  const providerVoiceRef = normalizeText(asset?.providerVoiceRef) || null;
  if (voiceAssetId) {
    return {
      voiceReference: {
        kind: 'voice_asset_id',
        stableRef: voiceAssetId,
      },
      voiceAssetId,
      providerVoiceRef,
    };
  }
  if (providerVoiceRef) {
    return {
      voiceReference: {
        kind: 'provider_voice_ref',
        stableRef: providerVoiceRef,
      },
      voiceAssetId,
      providerVoiceRef,
    };
  }
  return {
    voiceReference: null,
    voiceAssetId,
    providerVoiceRef,
  };
}

async function resolveInvokeInput(
  input: ChatAgentRuntimeInvokeInput,
): Promise<InvokeModLlmInput> {
  const routeInput = await resolveRouteInput(input);
  return {
    ...routeInput,
    prompt: requirePrompt(input.prompt),
    maxTokens: Number.isFinite(Number(input.maxOutputTokensRequested))
      && Number(input.maxOutputTokensRequested) > 0
      ? Math.floor(Number(input.maxOutputTokensRequested))
      : undefined,
    agentId: requireValue(
      input.agentId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agentId is missing',
    ),
  };
}

async function resolveRouteInput(
  input: ChatAgentRuntimeInvokeInput,
): Promise<ResolvedAgentRuntimeRouteInput> {
  if (!input.agentResolution || !input.agentResolution.ready) {
    throw createNimiError({
      message: `agent capability resolution not ready: ${input.agentResolution?.reason || 'projection_unavailable'}`,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  const snapshot = input.executionSnapshot;
  const slice = resolveExecutionSlice(snapshot, 'text.generate');
  const resolved = slice.resolvedBinding as NonNullable<import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding']>;
  if (resolved.source === 'local') {
    return {
      modId: CORE_CHAT_AGENT_MOD_ID,
      provider: requireValue(
        resolved.provider,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agent local route provider is missing',
      ),
      localProviderEndpoint: normalizeText(resolved.localProviderEndpoint) || normalizeText(resolved.endpoint) || undefined,
      localProviderModel: requireValue(
        resolved.modelId || resolved.model || resolved.localModelId,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agent local route model is missing',
      ),
      localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint) || normalizeText(resolved.endpoint) || undefined,
    };
  }

  if (resolved.source === 'cloud') {
    return {
      modId: CORE_CHAT_AGENT_MOD_ID,
      provider: requireValue(
        resolved.provider,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agent cloud route provider is missing',
      ),
      connectorId: requireValue(
        resolved.connectorId,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agent cloud route connector is missing',
      ),
      localProviderModel: requireValue(
        resolved.modelId || resolved.model,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agent cloud route model is missing',
      ),
    };
  }

  throw createNimiError({
    message: 'agent execution snapshot resolved to an invalid source',
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: 'select_runtime_route_binding',
    source: 'runtime',
  });
}

export function toChatAgentRuntimeError(error: unknown): { code: string; message: string } {
  return toChatUserFacingRuntimeError(error, 'Agent response failed');
}

export async function streamChatAgentRuntime(
  input: ChatAgentRuntimeInvokeInput,
  deps: ChatAgentRuntimeStreamDeps = {},
): Promise<ChatAgentRuntimeStreamResult> {
  const routeInput = await (deps.resolveRouteInputImpl || resolveRouteInput)(input);
  const resolved = resolveSourceAndModel(routeInput);
  const timeoutMs = 120_000;

  await (deps.ensureRuntimeLocalModelWarmImpl || ensureRuntimeLocalModelWarm)({
    modId: routeInput.modId,
    source: resolved.source,
    modelId: resolved.modelId,
    engine: resolved.provider,
    endpoint: resolved.endpoint,
    timeoutMs,
  });

  const callOptions = await (deps.buildRuntimeStreamOptionsImpl || buildRuntimeStreamOptions)({
    modId: routeInput.modId,
    timeoutMs,
    signal: input.signal,
    source: resolved.source,
    connectorId: routeInput.connectorId,
    providerEndpoint: resolved.endpoint,
  });
  const streamOutput = await (deps.getRuntimeClientImpl || getRuntimeClient)().ai.text.stream({
    model: resolved.modelId,
    route: resolved.source,
    connectorId: routeInput.connectorId,
    input: resolveRuntimeTextInput(input),
    system: normalizeText(input.systemPrompt) || undefined,
    maxTokens: Number.isFinite(Number(input.maxOutputTokensRequested))
      && Number(input.maxOutputTokensRequested) > 0
      ? Math.floor(Number(input.maxOutputTokensRequested))
      : undefined,
    reasoning: resolveChatThinkingConfig(
      input.reasoningPreference,
      resolveAgentChatThinkingSupport(),
    ),
    timeoutMs: callOptions.timeoutMs,
    signal: callOptions.signal,
    metadata: callOptions.metadata,
  });

  return {
    stream: streamOutput.stream,
    promptTraceId: String(callOptions.metadata.traceId || ''),
  };
}

export async function invokeChatAgentRuntime(
  input: ChatAgentRuntimeInvokeInput,
  deps: ChatAgentRuntimeInvokeDeps = {},
): Promise<ChatAgentRuntimeInvokeResult> {
  const invokeModLlmImpl = deps.invokeModLlmImpl || invokeModLlm;
  const invokeInput = await (deps.resolveInvokeInputImpl || resolveInvokeInput)(input);
  const result = await invokeModLlmImpl(invokeInput);
  return {
    text: String(result.text || ''),
    traceId: String(result.traceId || ''),
    promptTraceId: String(result.promptTraceId || ''),
  };
}

export async function generateChatAgentImageRuntime(
  input: ChatAgentImageRuntimeInvokeInput,
  deps: ChatAgentImageRuntimeInvokeDeps = {},
): Promise<ChatAgentImageRuntimeInvokeResult> {
  const prompt = normalizeText(input.prompt);
  if (!prompt) {
    throw createNimiError({
      message: 'agent image prompt is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_image_prompt',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.imageExecutionSnapshot, 'image.generate');
  const resolved = slice.resolvedBinding as NonNullable<import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding']>;
  const imageCapabilityParams = asRecord(input.imageCapabilityParams);
  const responseFormat = resolveAgentImageResponseFormat(imageCapabilityParams?.responseFormat);
  const size = normalizeText(imageCapabilityParams?.size) || undefined;
  const seed = normalizeFiniteNumber(imageCapabilityParams?.seed);
  const timeoutMs = normalizePositiveFiniteNumber(imageCapabilityParams?.timeoutMs);
  const extensions = buildAgentLocalImageWorkflowExtensions({
    resolved,
    params: imageCapabilityParams,
  });
  const extensionPayload = extensions ? toProtoStruct(extensions) : undefined;
  const modelId = requireValue(
    resolved.modelId || resolved.model || resolved.localModelId,
    ReasonCode.AI_INPUT_INVALID,
    'select_runtime_route_binding',
    'agent image route model is missing',
  );
  const runtimeClient = (deps.getRuntimeClientImpl || getRuntimeClient)();
  let artifact: Record<string, unknown> | null;
  let traceId: string;
  let diagnostics: AgentImageExecutionRuntimeDiagnostics | null = null;

  if (runtimeClient.ai?.submitScenarioJob && runtimeClient.ai?.getScenarioJob && runtimeClient.ai?.getScenarioArtifacts) {
    const callOptions = await (deps.buildRuntimeCallOptionsImpl || buildRuntimeCallOptions)({
      modId: CORE_CHAT_AGENT_MOD_ID,
      timeoutMs: timeoutMs ?? 180_000,
      source: resolved.source,
      connectorId: normalizeText(resolved.connectorId) || undefined,
      providerEndpoint: normalizeText(resolved.endpoint)
        || normalizeText(resolved.localProviderEndpoint)
        || normalizeText(resolved.localOpenAiEndpoint)
        || undefined,
    });
    const submitStartedAt = Date.now();
    const submitResponse = await runtimeClient.ai.submitScenarioJob({
      head: {
        appId: runtimeClient.appId,
        modelId,
        routePolicy: toRuntimeRoutePolicy(resolved.source),
        timeoutMs: timeoutMs ?? 180_000,
        connectorId: normalizeText(resolved.connectorId),
      },
      scenarioType: ScenarioType.IMAGE_GENERATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      requestId: callOptions.idempotencyKey,
      idempotencyKey: callOptions.idempotencyKey,
      labels: {
        surface: 'agent-chat',
      },
      extensions: extensionPayload
        ? [{
          namespace: AGENT_CHAT_IMAGE_EXTENSION_NAMESPACE,
          payload: extensionPayload,
        }]
        : [],
      spec: {
        spec: {
          oneofKind: 'imageGenerate' as const,
          imageGenerate: {
            prompt,
            negativePrompt: '',
            n: 1,
            size: size || '',
            aspectRatio: '',
            quality: '',
            style: '',
            seed: seed !== undefined ? String(seed) : '',
            referenceImages: [],
            mask: '',
            responseFormat: responseFormat || '',
          },
        },
      },
    }, {
      timeoutMs: timeoutMs ?? 180_000,
      metadata: callOptions.metadata,
    });
    const jobId = normalizeText(submitResponse.job?.jobId);
    if (!jobId) {
      throw createNimiError({
        message: 'agent image generation did not return a scenario job id',
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'retry_image_generation',
        source: 'runtime',
      });
    }
    traceId = normalizeText(submitResponse.job?.traceId) || normalizeText(callOptions.metadata.traceId);
    diagnostics = {
      imageJobSubmitMs: Date.now() - submitStartedAt,
      imageLoadMs: null,
      imageGenerateMs: null,
      artifactHydrateMs: null,
      queueWaitMs: null,
      loadCacheHit: null,
      residentReused: null,
      residentRestarted: null,
      queueSerialized: null,
      profileOverrideStep: null,
      profileOverrideCfgScale: null,
      profileOverrideSampler: null,
      profileOverrideScheduler: null,
    };
    for (;;) {
      const jobResponse = await runtimeClient.ai.getScenarioJob({ jobId }, {
        timeoutMs: timeoutMs ?? 180_000,
        metadata: callOptions.metadata,
      });
      const status = Number(jobResponse.job?.status || 0);
      traceId = normalizeText(jobResponse.job?.traceId) || traceId;
      if (status === ScenarioJobStatus.COMPLETED) {
        break;
      }
      if (
        status === ScenarioJobStatus.FAILED
        || status === ScenarioJobStatus.CANCELED
        || status === ScenarioJobStatus.TIMEOUT
      ) {
        throw createNimiError({
          message: normalizeText(jobResponse.job?.reasonDetail)
            || normalizeText(jobResponse.job?.reasonCode)
            || 'agent image generation job failed',
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'retry_image_generation',
          source: 'runtime',
        });
      }
      await sleepWithAbort(250, input.signal);
    }
    const artifactStartedAt = Date.now();
    const artifactsResponse = await runtimeClient.ai.getScenarioArtifacts({ jobId }, {
      timeoutMs: timeoutMs ?? 180_000,
      metadata: callOptions.metadata,
    });
    diagnostics.artifactHydrateMs = Date.now() - artifactStartedAt;
    traceId = normalizeText(artifactsResponse.traceId) || traceId;
    artifact = resolveAgentImageScenarioArtifact(artifactsResponse);
    const artifactDiagnostics = parseAgentImageArtifactDiagnostics(
      protoStructToJson((artifact as { metadata?: unknown } | null)?.metadata),
    );
    if (artifactDiagnostics) {
      diagnostics = {
        ...diagnostics,
        ...artifactDiagnostics,
        imageJobSubmitMs: diagnostics.imageJobSubmitMs,
        artifactHydrateMs: diagnostics.artifactHydrateMs,
      };
    }
  } else {
    const metadata = await (deps.buildRuntimeRequestMetadataImpl || buildRuntimeRequestMetadata)({
      source: resolved.source,
      connectorId: normalizeText(resolved.connectorId) || undefined,
      providerEndpoint: normalizeText(resolved.endpoint)
        || normalizeText(resolved.localProviderEndpoint)
        || normalizeText(resolved.localOpenAiEndpoint)
        || undefined,
    });
    const response = await runtimeClient.media.image.generate({
      model: modelId,
      prompt,
      route: resolved.source,
      connectorId: normalizeText(resolved.connectorId) || undefined,
      responseFormat,
      size,
      seed,
      timeoutMs,
      ...(extensions ? { extensions } : {}),
      metadata,
      signal: input.signal,
    });
    artifact = Array.isArray(response.artifacts)
      ? response.artifacts[0] as unknown as Record<string, unknown> | null
      : null;
    traceId = normalizeText(response.trace?.traceId) || normalizeText(metadata.traceId);
  }
  if (!artifact) {
    throw createNimiError({
      message: 'agent image generation returned no artifacts',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_image_generation',
      source: 'runtime',
    });
  }
  const mimeType = normalizeText((artifact as { mimeType?: unknown }).mimeType) || 'image/png';
  const uri = normalizeText((artifact as { uri?: unknown }).uri);
  const bytes = (artifact as { bytes?: Uint8Array | null }).bytes || null;
  const mediaUrl = uri || (bytes && bytes.length > 0 ? encodeBytesAsDataUrl(mimeType, bytes) : '');
  if (!mediaUrl) {
    throw createNimiError({
      message: 'agent image generation artifact has no uri or bytes',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_image_generation',
      source: 'runtime',
    });
  }
  return {
    mediaUrl,
    mimeType,
    artifactId: normalizeText((artifact as { artifactId?: unknown }).artifactId) || null,
    traceId,
    diagnostics,
  };
}

export async function synthesizeChatAgentVoiceRuntime(
  input: ChatAgentVoiceRuntimeInvokeInput,
  deps: ChatAgentVoiceRuntimeInvokeDeps = {},
): Promise<ChatAgentVoiceRuntimeInvokeResult> {
  const prompt = normalizeText(input.prompt);
  if (!prompt) {
    throw createNimiError({
      message: 'agent voice prompt is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_voice_prompt',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.voiceExecutionSnapshot, 'audio.synthesize');
  const resolved = slice.resolvedBinding as NonNullable<import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding']>;
  const metadata = await (deps.buildRuntimeRequestMetadataImpl || buildRuntimeRequestMetadata)({
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const response = await (deps.getRuntimeClientImpl || getRuntimeClient)().media.tts.synthesize({
    model: requireValue(
      resolved.modelId || resolved.model || resolved.localModelId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agent voice route model is missing',
    ),
    text: prompt,
    route: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    audioFormat: 'mp3',
    metadata,
    signal: input.signal,
  });
  const artifact = Array.isArray(response.artifacts) ? response.artifacts[0] : null;
  if (!artifact) {
    throw createNimiError({
      message: 'agent voice synthesis returned no artifacts',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_synthesis',
      source: 'runtime',
    });
  }
  const mimeType = normalizeText((artifact as { mimeType?: unknown }).mimeType) || 'audio/mpeg';
  const uri = normalizeText((artifact as { uri?: unknown }).uri);
  const bytes = (artifact as { bytes?: Uint8Array | null }).bytes || null;
  const mediaUrl = uri || (bytes && bytes.length > 0 ? encodeBytesAsDataUrl(mimeType, bytes) : '');
  if (!mediaUrl) {
    throw createNimiError({
      message: 'agent voice synthesis artifact has no uri or bytes',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_synthesis',
      source: 'runtime',
    });
  }
  return {
    mediaUrl,
    mimeType,
    artifactId: normalizeText((artifact as { artifactId?: unknown }).artifactId) || null,
    traceId: normalizeText(response.trace?.traceId) || normalizeText(metadata.traceId),
  };
}

export async function submitChatAgentVoiceWorkflowRuntime(
  input: ChatAgentVoiceWorkflowSubmitInput,
  deps: ChatAgentVoiceWorkflowRuntimeDeps = {},
): Promise<ChatAgentVoiceWorkflowSubmitResult> {
  const prompt = normalizeText(input.prompt);
  if (!prompt) {
    throw createNimiError({
      message: 'agent voice workflow prompt is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_voice_prompt',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(
    input.voiceWorkflowExecutionSnapshot,
    input.workflowIntent.capability,
  );
  const resolved = slice.resolvedBinding as NonNullable<import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding']>;
  const runtimeClient = (deps.getRuntimeClientImpl || getRuntimeClient)();
  const callOptions = await (deps.buildRuntimeCallOptionsImpl || buildRuntimeCallOptions)({
    modId: CORE_CHAT_AGENT_MOD_ID,
    timeoutMs: 180_000,
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const modelId = requireValue(
    resolved.modelId || resolved.model || resolved.localModelId,
    ReasonCode.AI_INPUT_INVALID,
    'select_runtime_route_binding',
    'agent voice workflow route model is missing',
  );
  const preferredName = `agent-chat-${input.turnId.slice(-6)}-${input.beatId.slice(-4)}`;
  const response = await runtimeClient.ai.submitScenarioJob({
    head: {
      appId: runtimeClient.appId,
      modelId,
      routePolicy: toRuntimeRoutePolicy(resolved.source),
      timeoutMs: 180_000,
      connectorId: normalizeText(resolved.connectorId),
    },
    scenarioType: input.workflowIntent.workflowType === 'tts_v2v'
      ? ScenarioType.VOICE_CLONE
      : ScenarioType.VOICE_DESIGN,
    executionMode: ExecutionMode.ASYNC_JOB,
    requestId: callOptions.idempotencyKey,
    idempotencyKey: callOptions.idempotencyKey,
    labels: {
      surface: 'agent-chat',
      thread_id: input.threadId,
      turn_id: input.turnId,
      beat_id: input.beatId,
    },
    extensions: [],
    spec: input.workflowIntent.workflowType === 'tts_v2v'
      ? {
        spec: {
          oneofKind: 'voiceClone' as const,
          voiceClone: {
            targetModelId: modelId,
            input: {
              referenceAudioBytes: input.referenceAudio?.bytes || (() => {
                throw createNimiError({
                  message: 'voice clone workflow requires current-thread reference audio',
                  reasonCode: ReasonCode.AI_INPUT_INVALID,
                  actionHint: 'record_voice_input',
                  source: 'runtime',
                });
              })(),
              referenceAudioMime: requireValue(
                input.referenceAudio?.mimeType,
                ReasonCode.AI_INPUT_INVALID,
                'record_voice_input',
                'voice clone workflow requires a reference audio mimeType',
              ),
              referenceAudioUri: '',
              text: prompt,
              preferredName,
              languageHints: [],
            },
          },
        },
      }
      : {
        spec: {
          oneofKind: 'voiceDesign' as const,
          voiceDesign: {
            targetModelId: modelId,
            input: {
              instructionText: prompt,
              previewText: prompt,
              language: '',
              preferredName,
            },
          },
        },
      },
  }, callOptions);
  const jobId = normalizeText(response.job?.jobId);
  if (!jobId) {
    throw createNimiError({
      message: 'voice workflow submit returned no jobId',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_workflow',
      source: 'runtime',
    });
  }
  const workflowStatus = resolveWorkflowJobStatus(Number(response.job?.status || ScenarioJobStatus.SUBMITTED));
  if (workflowStatus === 'complete' || workflowStatus === 'failed' || workflowStatus === 'canceled') {
    throw createNimiError({
      message: 'voice workflow submit returned an unexpected terminal state',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_workflow',
      source: 'runtime',
    });
  }
  const voiceReference = resolveVoiceReferenceFromAsset(response.asset || null);
  return {
    jobId,
    traceId: normalizeText(response.job?.traceId) || normalizeText(callOptions.metadata.traceId),
    workflowStatus,
    voiceReference: voiceReference.voiceReference,
    voiceAssetId: voiceReference.voiceAssetId,
    providerVoiceRef: voiceReference.providerVoiceRef,
  };
}

export async function pollChatAgentVoiceWorkflowRuntime(
  input: {
    jobId: string;
    signal?: AbortSignal;
  },
  deps: ChatAgentVoiceWorkflowRuntimeDeps = {},
): Promise<ChatAgentVoiceWorkflowPollResult> {
  const runtimeClient = (deps.getRuntimeClientImpl || getRuntimeClient)();
  const response = await runtimeClient.ai.getScenarioJob({
    jobId: requireValue(
      input.jobId,
      ReasonCode.AI_INPUT_INVALID,
      'retry_voice_workflow',
      'voice workflow jobId is required',
    ),
  });
  const workflowStatus = resolveWorkflowJobStatus(Number(response.job?.status || 0));
  return {
    workflowStatus,
    traceId: normalizeText(response.job?.traceId) || null,
    message: normalizeText(response.job?.reasonDetail) || normalizeText(response.job?.reasonCode) || null,
  };
}

export async function synthesizeChatAgentVoiceReferenceRuntime(
  input: ChatAgentVoiceReferenceSynthesisInput,
  deps: ChatAgentVoiceWorkflowRuntimeDeps = {},
): Promise<ChatAgentVoiceRuntimeInvokeResult> {
  const prompt = normalizeText(input.prompt);
  if (!prompt) {
    throw createNimiError({
      message: 'projected voice playback requires text',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_voice_prompt',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.voiceExecutionSnapshot, 'audio.synthesize');
  const resolved = slice.resolvedBinding as NonNullable<import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding']>;
  const runtimeClient = (deps.getRuntimeClientImpl || getRuntimeClient)();
  const callOptions = await (deps.buildRuntimeCallOptionsImpl || buildRuntimeCallOptions)({
    modId: CORE_CHAT_AGENT_MOD_ID,
    timeoutMs: 120_000,
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const response = await runtimeClient.ai.executeScenario({
    head: {
      appId: runtimeClient.appId,
      modelId: requireValue(
        resolved.modelId || resolved.model || resolved.localModelId,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agent voice route model is missing',
      ),
      routePolicy: toRuntimeRoutePolicy(resolved.source),
      timeoutMs: 120_000,
      connectorId: normalizeText(resolved.connectorId),
    },
    scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
    executionMode: ExecutionMode.SYNC,
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'speechSynthesize' as const,
        speechSynthesize: {
          text: prompt,
          audioFormat: 'mp3',
          language: '',
          sampleRateHz: 0,
          speed: 0,
          pitch: 0,
          volume: 0,
          emotion: '',
          timingMode: 0,
          voiceRef: toRuntimeVoiceReference(input.voiceReference),
        },
      },
    },
  }, callOptions);
  const responseArtifacts = (
    Array.isArray((response as { artifacts?: unknown[] }).artifacts)
      ? (response as { artifacts?: unknown[] }).artifacts
      : []
  ) as unknown[];
  const artifact = responseArtifacts[0] || null;
  if (!artifact) {
    throw createNimiError({
      message: 'projected voice playback returned no artifacts',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_synthesis',
      source: 'runtime',
    });
  }
  const mimeType = normalizeText((artifact as { mimeType?: unknown }).mimeType) || 'audio/mpeg';
  const uri = normalizeText((artifact as { uri?: unknown }).uri);
  const bytes = (artifact as { bytes?: Uint8Array | null }).bytes || null;
  const mediaUrl = uri || (bytes && bytes.length > 0 ? encodeBytesAsDataUrl(mimeType, bytes) : '');
  if (!mediaUrl) {
    throw createNimiError({
      message: 'projected voice playback artifact has no uri or bytes',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_synthesis',
      source: 'runtime',
    });
  }
  return {
    mediaUrl,
    mimeType,
    artifactId: normalizeText((artifact as { artifactId?: unknown }).artifactId) || null,
    traceId: normalizeText((response as { trace?: { traceId?: string } }).trace?.traceId)
      || normalizeText(callOptions.metadata.traceId),
  };
}

export async function transcribeChatAgentVoiceRuntime(
  input: ChatAgentTranscribeRuntimeInvokeInput,
  deps: ChatAgentTranscribeRuntimeInvokeDeps = {},
): Promise<ChatAgentTranscribeRuntimeInvokeResult> {
  if (!(input.audioBytes instanceof Uint8Array) || input.audioBytes.length === 0) {
    throw createNimiError({
      message: 'agent voice transcription requires audio bytes',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'record_voice_input',
      source: 'runtime',
    });
  }
  const mimeType = normalizeText(input.mimeType);
  if (!mimeType) {
    throw createNimiError({
      message: 'agent voice transcription requires an audio mimeType',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'record_voice_input',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.transcribeExecutionSnapshot, 'audio.transcribe');
  const resolved = slice.resolvedBinding as NonNullable<import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding']>;
  const metadata = await (deps.buildRuntimeRequestMetadataImpl || buildRuntimeRequestMetadata)({
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const response = await (deps.getRuntimeClientImpl || getRuntimeClient)().media.stt.transcribe({
    model: requireValue(
      resolved.modelId || resolved.model || resolved.localModelId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agent voice transcribe route model is missing',
    ),
    audio: {
      kind: 'bytes',
      bytes: input.audioBytes,
    },
    mimeType,
    language: normalizeText(input.language) || undefined,
    route: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    metadata,
    signal: input.signal,
  });
  const text = normalizeText(response.text);
  if (!text) {
    throw createNimiError({
      message: 'agent voice transcription returned no transcript text',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_transcription',
      source: 'runtime',
    });
  }
  return {
    text,
    traceId: normalizeText(response.trace?.traceId) || normalizeText(metadata.traceId),
  };
}
