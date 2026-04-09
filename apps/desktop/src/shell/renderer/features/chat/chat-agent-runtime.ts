import {
  asNimiError,
  createNimiError,
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
import type {
  AgentEffectiveCapabilityResolution,
  AISnapshot,
} from './conversation-capability';

export type ChatAgentRuntimeInvokeInput = {
  agentId: string;
  prompt?: string;
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
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
};

export type ChatAgentImageRuntimeInvokeDeps = {
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
    content: message.text,
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
  capability: 'text.generate' | 'image.generate',
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

async function resolveInvokeInput(
  input: ChatAgentRuntimeInvokeInput,
): Promise<InvokeModLlmInput> {
  const routeInput = await resolveRouteInput(input);
  return {
    ...routeInput,
    prompt: requirePrompt(input.prompt),
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
  const normalized = asNimiError(error);
  return {
    code: String(normalized.reasonCode || ReasonCode.RUNTIME_CALL_FAILED).trim() || ReasonCode.RUNTIME_CALL_FAILED,
    message: String(normalized.message || 'Agent response failed').trim() || 'Agent response failed',
  };
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
  const metadata = await (deps.buildRuntimeRequestMetadataImpl || buildRuntimeRequestMetadata)({
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const imageCapabilityParams = asRecord(input.imageCapabilityParams);
  const responseFormat = resolveAgentImageResponseFormat(imageCapabilityParams?.responseFormat);
  const size = normalizeText(imageCapabilityParams?.size) || undefined;
  const seed = normalizeFiniteNumber(imageCapabilityParams?.seed);
  const timeoutMs = normalizePositiveFiniteNumber(imageCapabilityParams?.timeoutMs);
  const extensions = buildAgentLocalImageWorkflowExtensions({
    resolved,
    params: imageCapabilityParams,
  });
  const response = await (deps.getRuntimeClientImpl || getRuntimeClient)().media.image.generate({
    model: requireValue(
      resolved.modelId || resolved.model || resolved.localModelId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agent image route model is missing',
    ),
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
  const artifact = Array.isArray(response.artifacts) ? response.artifacts[0] : null;
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
    traceId: normalizeText(response.trace?.traceId) || normalizeText(metadata.traceId),
  };
}
