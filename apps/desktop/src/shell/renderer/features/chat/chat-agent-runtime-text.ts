import type {
  TextMessage,
} from '@nimiplatform/sdk/runtime';
import {
  createNimiError,
  type TextGenerateOutput,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  buildRuntimeCallOptions,
  buildRuntimeStreamOptions,
  ensureRuntimeLocalModelWarm,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import { runtimeRouteCallTargetFromResolvedBinding } from '@nimiplatform/sdk/ai';
import {
  resolveChatThinkingConfig,
  resolveTextExecutionSnapshotThinkingSupport,
} from './chat-shared-thinking';
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
  CORE_CHAT_AGENT_TARGET_ID,
} from './chat-agent-runtime-types';
import {
  normalizeText,
  requirePrompt,
  resolveExecutionSlice,
} from './chat-agent-runtime-shared';
import type { ConversationRuntimeTextMessage } from '@nimiplatform/kit/features/chat/headless';
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
  return resolveRouteInputFromTextResolvedBinding(resolved);
}

export function resolveRouteInputFromTextResolvedBinding(
  resolved: AgentRuntimeResolvedBinding,
): ResolvedAgentRuntimeRouteInput {
  runtimeRouteCallTargetFromResolvedBinding(resolved);
  return {
    targetId: CORE_CHAT_AGENT_TARGET_ID,
    resolvedBinding: resolved,
  };
}

export function toChatAgentRuntimeError(error: unknown): { code: string; message: string } {
  return toChatUserFacingRuntimeError(error, 'Agent response failed');
}

export async function streamChatAgentRuntime(
  input: ChatAgentRuntimeInvokeInput,
  deps: ChatAgentRuntimeStreamDeps = {},
): Promise<ChatAgentRuntimeStreamResult> {
  const routeInput = await (deps.resolveRouteInputImpl || resolveRouteInput)(input);
  const resolved = runtimeRouteCallTargetFromResolvedBinding(routeInput.resolvedBinding);
  const timeoutMs = 120_000;

  await (deps.ensureRuntimeLocalModelWarmImpl || ensureRuntimeLocalModelWarm)({
    targetId: routeInput.targetId,
    resolvedBinding: routeInput.resolvedBinding,
    timeoutMs,
  });

  const callOptions = await (deps.buildRuntimeStreamOptionsImpl || buildRuntimeStreamOptions)({
    targetId: routeInput.targetId,
    timeoutMs,
    signal: input.signal,
    source: resolved.source,
    connectorId: resolved.connectorId,
    providerEndpoint: resolved.endpoint,
  });
  const streamOutput = await (deps.getRuntimeClientImpl || getRuntimeClient)().ai.text.stream({
    model: resolved.modelId,
    route: resolved.source,
    connectorId: resolved.connectorId,
    input: resolveRuntimeTextInput(input),
    system: normalizeText(input.systemPrompt) || undefined,
    maxTokens: Number.isFinite(Number(input.maxOutputTokensRequested))
      && Number(input.maxOutputTokensRequested) > 0
      ? Math.floor(Number(input.maxOutputTokensRequested))
      : undefined,
    reasoning: resolveChatThinkingConfig(
      input.reasoningPreference,
      resolveTextExecutionSnapshotThinkingSupport(
        input.executionSnapshot?.conversationCapabilitySlice as Parameters<typeof resolveTextExecutionSnapshotThinkingSupport>[0],
      ),
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
  const routeInput = await (deps.resolveRouteInputImpl || resolveRouteInput)(input);
  const resolved = runtimeRouteCallTargetFromResolvedBinding(routeInput.resolvedBinding);
  const timeoutMs = 120_000;

  await (deps.ensureRuntimeLocalModelWarmImpl || ensureRuntimeLocalModelWarm)({
    targetId: routeInput.targetId,
    resolvedBinding: routeInput.resolvedBinding,
    timeoutMs,
  });

  const callOptions = await (deps.buildRuntimeCallOptionsImpl || buildRuntimeCallOptions)({
    targetId: routeInput.targetId,
    timeoutMs,
    source: resolved.source,
    connectorId: resolved.connectorId,
    providerEndpoint: resolved.endpoint,
  });
  const result: TextGenerateOutput = await (deps.getRuntimeClientImpl || getRuntimeClient)().ai.text.generate({
    model: resolved.modelId,
    route: resolved.source,
    connectorId: resolved.connectorId,
    input: resolveRuntimeTextInput(input),
    system: normalizeText(input.systemPrompt) || undefined,
    maxTokens: Number.isFinite(Number(input.maxOutputTokensRequested))
      && Number(input.maxOutputTokensRequested) > 0
      ? Math.floor(Number(input.maxOutputTokensRequested))
      : undefined,
    reasoning: resolveChatThinkingConfig(
      input.reasoningPreference,
      resolveTextExecutionSnapshotThinkingSupport(
        input.executionSnapshot?.conversationCapabilitySlice as Parameters<typeof resolveTextExecutionSnapshotThinkingSupport>[0],
      ),
    ),
    timeoutMs: callOptions.timeoutMs,
    metadata: callOptions.metadata,
  });
  const promptTraceId = String(callOptions.metadata.traceId || '');
  return {
    text: String(result.text || ''),
    traceId: String(result.trace?.traceId || promptTraceId),
    promptTraceId,
  };
}
