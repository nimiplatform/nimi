import {
  createNimiRuntimeAIModel,
  type NimiRuntimeAIRoutePolicy,
} from '@nimiplatform/sdk/ai';
import type { NimiMessage, NimiMessagePart, NimiRunEvent } from '@nimiplatform/sdk/contracts';
import { createNimiError } from '@nimiplatform/sdk/types';
import type { ConversationRuntimeTextMessage } from '@nimiplatform/kit/features/chat/headless';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  desktopRuntimeRouteAccess,
} from '../../infra/runtime-route-host-access';
import { getDesktopAppId, getDesktopRuntime } from '../../infra/sdk/desktop-nimi-client-session';
import {
  type NimiRuntimeResolvedBinding,
} from '@nimiplatform/sdk/runtime';
import {
  resolveChatThinkingConfig,
  resolveTextExecutionSnapshotThinkingSupport,
  type ChatThinkingPreference,
} from './chat-shared-thinking';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message';
import {
  aiConfigTargetRefFromRouteTargetRef,
  type NimiAISnapshot,
} from './conversation-capability';
import type { TFunction } from 'i18next';

export type ChatAiRuntimeTextInput = {
  prompt: string;
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
  threadId: string;
  reasoningPreference: ChatThinkingPreference;
  executionSnapshot: NimiAISnapshot | null;
  signal?: AbortSignal;
};

export type ChatAiRuntimeStreamResult = {
  stream: AsyncIterable<NimiRunEvent>;
  promptTraceId: string;
};

type ChatAiRuntimeTextExecutionInput = {
  targetId: string;
  resolvedBinding: NimiRuntimeResolvedBinding;
};

export type ChatAiRuntimeStreamDeps = {
  resolveTextExecutionInputImpl?: (input: ChatAiRuntimeTextInput) => Promise<ChatAiRuntimeTextExecutionInput>;
};

export const CORE_CHAT_AI_TARGET_ID = 'core.chat-ai';
export const CHAT_AI_TEXT_GENERATE_TIMEOUT_MS = 120_000;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNimiTextMessage(message: ConversationRuntimeTextMessage): NimiMessage {
  return {
    role: message.role,
    content: toNimiMessageParts(message),
    name: normalizeText(message.name) || undefined,
  };
}

function toNimiMessageParts(message: ConversationRuntimeTextMessage): readonly NimiMessagePart[] {
  if (Array.isArray(message.content)) {
    return message.content;
  }
  const text = normalizeText(typeof message.content === 'string' ? message.content : message.text);
  return text ? [{ type: 'text', text }] : [];
}

function resolveRuntimeTextMessages(input: ChatAiRuntimeTextInput): readonly NimiMessage[] {
  const messages: NimiMessage[] = [];
  const systemPrompt = normalizeText(input.systemPrompt);
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: [{ type: 'text', text: systemPrompt }],
    });
  }
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    messages.push(...input.messages.map((message) => toNimiTextMessage(message)));
  } else {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: input.prompt }],
    });
  }
  return messages;
}

function toNimiRuntimeAIRoutePolicy(source: string): NimiRuntimeAIRoutePolicy {
  if (source === 'local-runtime') return 'local';
  if (source === 'cloud-connector') return 'cloud';
  return 'unspecified';
}

function resolvedBindingModelId(resolved: NimiRuntimeResolvedBinding): string {
  return normalizeText(
    resolved.providerModelId
    || resolved.modelId
    || resolved.model
    || resolved.localAssetId,
  );
}

async function resolveRuntimeTextExecutionInput(
  input: ChatAiRuntimeTextInput,
): Promise<ChatAiRuntimeTextExecutionInput> {
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
  const resolved = slice.resolvedTarget as import('./conversation-capability').ConversationExecutionSnapshot['resolvedBinding'];
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
  };
}

export function toChatAiRuntimeError(error: unknown, t: TFunction): { code: string; message: string } {
  return toChatUserFacingRuntimeError(error, 'AI response failed', t);
}

export async function streamChatAiRuntime(
  input: ChatAiRuntimeTextInput,
  deps: ChatAiRuntimeStreamDeps = {},
): Promise<ChatAiRuntimeStreamResult> {
  const executionInput = await (deps.resolveTextExecutionInputImpl || resolveRuntimeTextExecutionInput)(input);
  const resolved = executionInput.resolvedBinding;
  const timeoutMs = CHAT_AI_TEXT_GENERATE_TIMEOUT_MS;

  await desktopRuntimeRouteAccess.ensureLocalModelWarm({
    targetId: executionInput.targetId,
    resolvedBinding: executionInput.resolvedBinding,
    timeoutMs,
  });

  const callOptions = await desktopRuntimeRouteAccess.buildStreamOptions({
    targetId: executionInput.targetId,
    timeoutMs,
    signal: input.signal,
    source: resolved.source,
    connectorId: resolved.connectorId,
    providerEndpoint: resolved.endpoint,
  });
  const metadata = callOptions.metadata ?? {};
  const targetRef = aiConfigTargetRefFromRouteTargetRef(resolved.targetRef);
  if (!targetRef) {
    throw createNimiError({
      message: 'text.generate execution snapshot targetRef is missing or invalid',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  const model = createNimiRuntimeAIModel({
    runtime: getDesktopRuntime(),
    appId: getDesktopAppId(),
    model: {
      providerId: normalizeText(resolved.connectorId) || undefined,
      modelId: resolvedBindingModelId(resolved),
    },
    routePolicy: toNimiRuntimeAIRoutePolicy(resolved.source),
    connectorId: normalizeText(resolved.connectorId) || undefined,
    timeoutMs: callOptions.timeoutMs,
    metadata,
    targetRef,
    reasoning: resolveChatThinkingConfig(
      input.reasoningPreference,
      resolveTextExecutionSnapshotThinkingSupport(input.executionSnapshot?.conversationCapabilitySlice as Parameters<typeof resolveTextExecutionSnapshotThinkingSupport>[0]),
    ),
  });
  if (!model.streamText) {
    throw createNimiError({
      message: `Runtime text model ${model.model.modelId} does not support streaming`,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_streaming_text_model',
      source: 'runtime',
    });
  }

  return {
    stream: await model.streamText({
      model: model.model,
      messages: resolveRuntimeTextMessages(input),
      signal: callOptions.signal,
      parameters: {
        metadata,
      },
    }),
    promptTraceId: String(metadata.traceId || ''),
  };
}
