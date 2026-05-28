import {
  createNimiError,
  type TextMessage,
  type TextStreamOutput,
} from '@nimiplatform/sdk/runtime';
import type { ConversationRuntimeTextMessage } from '@nimiplatform/kit/features/chat/headless';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { invokeRuntimeLlm } from '@runtime/llm-adapter/execution/invoke-text';
import type { InvokeRuntimeLlmInput, InvokeRuntimeLlmOutput } from '@runtime/llm-adapter/execution/types';
import {
  buildRuntimeStreamOptions,
  ensureRuntimeLocalModelWarm,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import { runtimeRouteCallTargetFromResolvedBinding } from '@nimiplatform/sdk/ai';
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
  invokeRuntimeLlmImpl?: (input: InvokeRuntimeLlmInput) => Promise<InvokeRuntimeLlmOutput>;
};

export type ChatAiRuntimeStreamDeps = {
  resolveInvokeInputImpl?: (input: ChatAiRuntimeInvokeInput) => Promise<InvokeRuntimeLlmInput>;
};

export const CORE_CHAT_AI_TARGET_ID = 'core.chat-ai';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
): Promise<InvokeRuntimeLlmInput> {
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

  return {
    targetId: CORE_CHAT_AI_TARGET_ID,
    resolvedBinding: resolved,
    prompt: input.prompt,
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
  const resolved = runtimeRouteCallTargetFromResolvedBinding(invokeInput.resolvedBinding);
  const timeoutMs = 120_000;

  await ensureRuntimeLocalModelWarm({
    targetId: invokeInput.targetId,
    resolvedBinding: invokeInput.resolvedBinding,
    timeoutMs,
  });

  const callOptions = await buildRuntimeStreamOptions({
    targetId: invokeInput.targetId,
    timeoutMs,
    signal: input.signal,
    source: resolved.source,
    connectorId: resolved.connectorId,
    providerEndpoint: resolved.endpoint,
  });
  const streamOutput = await getRuntimeClient().ai.text.stream({
    model: resolved.modelId,
    route: resolved.source,
    connectorId: resolved.connectorId,
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
  const invokeRuntimeLlmImpl = deps.invokeRuntimeLlmImpl || invokeRuntimeLlm;
  const invokeInput = await resolveInvokeInput(input);
  const result = await invokeRuntimeLlmImpl(invokeInput);
  return {
    text: String(result.text || ''),
    traceId: String(result.traceId || ''),
    promptTraceId: String(result.promptTraceId || ''),
  };
}
