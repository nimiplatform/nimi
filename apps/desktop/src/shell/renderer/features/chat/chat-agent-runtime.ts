import {
  asNimiError,
  createNimiError,
  type TextStreamOutput,
} from '@nimiplatform/sdk/runtime';
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
  prompt: string;
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

export type ChatAgentRuntimeStreamDeps = {
  resolveInvokeInputImpl?: (input: ChatAgentRuntimeInvokeInput) => Promise<InvokeModLlmInput>;
};

export const CORE_CHAT_AGENT_MOD_ID = 'core.chat-agent';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
      prompt: input.prompt,
      agentId: requireValue(
        input.agentId,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agentId is missing',
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
      prompt: input.prompt,
      agentId: requireValue(
        input.agentId,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agentId is missing',
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
  const invokeInput = await (deps.resolveInvokeInputImpl || resolveInvokeInput)(input);
  const resolved = resolveSourceAndModel(invokeInput);
  const timeoutMs = 120_000;

  await ensureRuntimeLocalModelWarm({
    modId: invokeInput.modId,
    source: resolved.source,
    modelId: resolved.modelId,
    engine: resolved.provider,
    endpoint: resolved.endpoint,
    timeoutMs,
  });

  const callOptions = await buildRuntimeStreamOptions({
    modId: invokeInput.modId,
    timeoutMs,
    signal: input.signal,
    source: resolved.source,
    connectorId: invokeInput.connectorId,
    providerEndpoint: resolved.endpoint,
  });
  const streamOutput = await getRuntimeClient().ai.text.stream({
    model: resolved.modelId,
    route: resolved.source,
    connectorId: invokeInput.connectorId,
    input: invokeInput.prompt,
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
    responseFormat: 'url',
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
