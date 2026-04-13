import type {
  TextMessage,
} from '@nimiplatform/sdk/runtime';
import {
  createNimiError,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { invokeModLlm } from '@runtime/llm-adapter/execution';
import {
  buildRuntimeStreamOptions,
  ensureRuntimeLocalModelWarm,
  getRuntimeClient,
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
} from './chat-thinking';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message';
import type {
  ChatAgentRuntimeInvokeDeps,
  ChatAgentRuntimeInvokeInput,
  ChatAgentRuntimeInvokeResult,
  ChatAgentRuntimeStreamDeps,
  ChatAgentRuntimeStreamResult,
  ResolvedAgentRuntimeRouteInput,
} from './chat-agent-runtime-types';
import {
  CORE_CHAT_AGENT_MOD_ID,
} from './chat-agent-runtime-types';
import {
  normalizeText,
  requirePrompt,
  requireValue,
  resolveExecutionSlice,
} from './chat-agent-runtime-shared';
import type { ConversationRuntimeTextMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { AgentRuntimeResolvedBinding } from './chat-agent-runtime-types';

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

async function resolveInvokeInput(
  input: ChatAgentRuntimeInvokeInput,
): Promise<import('@runtime/llm-adapter/execution').InvokeModLlmInput> {
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

export async function resolveRouteInput(
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
  const slice = resolveExecutionSlice(input.executionSnapshot, 'text.generate');
  const resolved = slice.resolvedBinding as AgentRuntimeResolvedBinding;
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
