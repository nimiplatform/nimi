import type { ConversationRuntimeAdapter } from '@nimiplatform/kit/features/chat/headless';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import { streamChatAiRuntime } from './chat-nimi-runtime';
import {
  createNimiConversationAISnapshot,
  type NimiAIConfig,
  type ConversationCapabilityProjection,
} from './conversation-capability';
import {
  peekDesktopAISchedulingForEvidence,
  recordDesktopAISnapshot,
  resolveNimiAIConfigRuntimeSchedulingTargetForCapability,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import { withPromptTrace } from './chat-nimi-shell-core';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolvedBindingModelId(
  binding: NonNullable<ConversationCapabilityProjection['resolvedBinding']>,
): string {
  return normalizeText(
    binding.providerModelId
    || binding.modelId
    || binding.model
    || binding.localAssetId,
  );
}

export function resolveChatAiConversationRuntimeRequest(
  projection: ConversationCapabilityProjection | null,
): {
  model: string;
  route?: 'local' | 'cloud';
  connectorId?: string;
} {
  const binding = projection?.resolvedBinding;
  const model = binding ? resolvedBindingModelId(binding) : '';
  if (!binding || !model) {
    throw new Error('text.generate execution route is missing an explicit model');
  }
  return {
    model,
    route: binding.source === 'local-runtime'
      ? 'local'
      : binding.source === 'cloud-connector'
        ? 'cloud'
        : undefined,
    connectorId: normalizeText(binding.connectorId) || undefined,
  };
}

export function createChatAiConversationRuntimeAdapter(input: {
  reasoningPreference: ChatThinkingPreference;
  getTextProjection: () => ConversationCapabilityProjection | null;
  aiConfig: NimiAIConfig;
}): ConversationRuntimeAdapter {
  return {
    async streamText(request) {
      const textProjection = input.getTextProjection();
      const prompt = request.messages[request.messages.length - 1]?.text || '';
      // K-AIEXEC-003: capture scheduling evidence before execution.
      const runtimeEvidence = textProjection?.supported
        ? await peekDesktopAISchedulingForEvidence({
          scopeRef: input.aiConfig.scopeRef,
          target: resolveNimiAIConfigRuntimeSchedulingTargetForCapability(input.aiConfig, 'text.generate'),
        })
        : null;
      const executionSnapshot = textProjection?.supported
        ? createNimiConversationAISnapshot({
          config: input.aiConfig,
          capability: 'text.generate',
          projection: textProjection,
          runtimeEvidence,
        })
        : null;
      if (executionSnapshot) {
        recordDesktopAISnapshot(executionSnapshot);
      }
      const runtimeResult = await streamChatAiRuntime({
        prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        threadId: request.threadId,
        reasoningPreference: input.reasoningPreference,
        executionSnapshot,
        signal: request.signal,
      });
      return (async function* () {
        for await (const part of runtimeResult.stream) {
          yield withPromptTrace(part, runtimeResult.promptTraceId);
        }
      })();
    },
  };
}
