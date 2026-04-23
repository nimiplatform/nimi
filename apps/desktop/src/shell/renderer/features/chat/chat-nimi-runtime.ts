import {
  createNimiError,
  type TextMessage,
  type TextStreamOutput,
} from '@nimiplatform/sdk/runtime';
import type { ConversationRuntimeTextMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { invokeModLlm } from '@runtime/llm-adapter/execution';
import type { InvokeModLlmInput, InvokeModLlmOutput } from '@runtime/llm-adapter/execution';
import {
  buildRuntimeStreamOptions,
  ensureRuntimeLocalModelWarm,
  getRuntimeClient,
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  resolveChatThinkingConfig,
  resolveTextExecutionSnapshotThinkingSupport,
  type ChatThinkingPreference,
} from './chat-shared-thinking';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message';
import type { AISnapshot } from './conversation-capability';

export type ChatAiRuntimeInvokeInput = {
  prompt: string;
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
  threadId: string;
  reasoningPreference: ChatThinkingPreference;
  executionSnapshot: AISnapshot | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  signal?: AbortSignal;
};

export type ChatAiRuntimeInvokeResult = {
  text: string;
  traceId: string;
  promptTraceId: string;
};

export type ChatAiRuntimeStreamResult = {
  stream: TextStreamOutput['stream'];
  promptTraceId: string;
};

export type ChatAiRuntimeInvokeDeps = {
  invokeModLlmImpl?: (input: InvokeModLlmInput) => Promise<InvokeModLlmOutput>;
};

export type ChatAiRuntimeStreamDeps = {
  resolveInvokeInputImpl?: (input: ChatAiRuntimeInvokeInput) => Promise<InvokeModLlmInput>;
};

export const CORE_CHAT_AI_MOD_ID = 'core.chat-ai';

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

function toSdkTextMessage(message: ConversationRuntimeTextMessage): TextMessage {
  return {
    role: message.role,
    content: message.content ?? message.text,
    name: normalizeText(message.name) || undefined,
  };
}

function resolveRuntimeTextInput(input: ChatAiRuntimeInvokeInput): string | TextMessage[] {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return input.messages.map((message) => toSdkTextMessage(message));
  }
  return input.prompt;
}

async function resolveInvokeInput(
  input: ChatAiRuntimeInvokeInput,
): Promise<InvokeModLlmInput> {
  const snapshot = input.executionSnapshot;
  const slice = snapshot?.conversationCapabilitySlice;
  if (!slice || slice.capability !== 'text.generate') {
    throw createNimiError({
      message: 'text.generate execution snapshot is not available',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  const resolved = slice.resolvedBinding as import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding'];
  if (!resolved) {
    throw createNimiError({
      message: 'text.generate execution snapshot resolved binding is missing',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }

  if (resolved.source === 'local') {
    return {
      modId: CORE_CHAT_AI_MOD_ID,
      provider: requireValue(
        resolved.provider,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'local AI route provider is missing',
      ),
      prompt: input.prompt,
      localProviderEndpoint: normalizeText(resolved.localProviderEndpoint) || normalizeText(resolved.endpoint) || undefined,
      localProviderModel: requireValue(
        resolved.modelId || resolved.model || resolved.localModelId,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'local AI route model is missing',
      ),
      localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint) || normalizeText(resolved.endpoint) || undefined,
    };
  }

  return {
    modId: CORE_CHAT_AI_MOD_ID,
    provider: requireValue(
      resolved.provider,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'cloud AI route provider is missing',
    ),
    prompt: input.prompt,
    connectorId: requireValue(
      resolved.connectorId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'cloud AI route connector is missing',
    ),
    localProviderModel: requireValue(
      resolved.modelId || resolved.model,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'cloud AI route model is missing',
    ),
  };
}

export function toChatAiRuntimeError(error: unknown): { code: string; message: string } {
  return toChatUserFacingRuntimeError(error, 'AI response failed');
}

export async function streamChatAiRuntime(
  input: ChatAiRuntimeInvokeInput,
  deps: ChatAiRuntimeStreamDeps = {},
): Promise<ChatAiRuntimeStreamResult> {
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
    input: resolveRuntimeTextInput(input),
    system: normalizeText(input.systemPrompt) || undefined,
    reasoning: resolveChatThinkingConfig(
      input.reasoningPreference,
      resolveTextExecutionSnapshotThinkingSupport(input.executionSnapshot?.conversationCapabilitySlice as Parameters<typeof resolveTextExecutionSnapshotThinkingSupport>[0]),
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

export async function invokeChatAiRuntime(
  input: ChatAiRuntimeInvokeInput,
  deps: ChatAiRuntimeInvokeDeps = {},
): Promise<ChatAiRuntimeInvokeResult> {
  const invokeModLlmImpl = deps.invokeModLlmImpl || invokeModLlm;
  const invokeInput = await resolveInvokeInput(input);
  const result = await invokeModLlmImpl(invokeInput);
  return {
    text: String(result.text || ''),
    traceId: String(result.traceId || ''),
    promptTraceId: String(result.promptTraceId || ''),
  };
}
