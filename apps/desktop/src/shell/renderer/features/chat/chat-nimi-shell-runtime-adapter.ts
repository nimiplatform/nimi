import type { ConversationRuntimeAdapter } from '@nimiplatform/kit/features/chat/headless';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import { streamChatAiRuntime } from './chat-nimi-runtime';
import {
  createNimiConversationAISnapshot,
  type NimiAIConfig,
  type ConversationCapabilityProjection,
} from './conversation-capability';
import {
  createNimiAIRuntimeEvidence,
  resolveNimiAIConfigRuntimeSchedulingTargetForCapability,
} from '@nimiplatform/sdk/ai';
import { withPromptTrace } from './chat-nimi-shell-core';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

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
  sdk: DesktopRendererSdkPort;
  now: () => number;
}): ConversationRuntimeAdapter {
  return {
    async streamText(request) {
      const textProjection = input.getTextProjection();
      const prompt = request.messages[request.messages.length - 1]?.text || '';
      // K-AIEXEC-003: capture scheduling evidence before execution.
      const schedulingTarget = resolveNimiAIConfigRuntimeSchedulingTargetForCapability(
        input.aiConfig,
        'text.generate',
      );
      const runtimeEvidence = textProjection?.supported && schedulingTarget
        ? createNimiAIRuntimeEvidence({
          schedulingJudgement: await input.sdk.aiConfig().aiConfig.probeSchedulingTarget(
            input.aiConfig.scopeRef,
            schedulingTarget,
            input.sdk.machineProduct(),
          ),
        })
        : null;
      const executionSnapshot = textProjection?.supported
        ? createNimiConversationAISnapshot({
          config: input.aiConfig,
          capability: 'text.generate',
          projection: textProjection,
          runtimeEvidence,
          createdAtMs: input.now(),
        })
        : null;
      if (executionSnapshot) {
        input.sdk.aiConfig().aiSnapshot.record(executionSnapshot);
      }
      const runtimeResult = await streamChatAiRuntime({
        prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        threadId: request.threadId,
        reasoningPreference: input.reasoningPreference,
        executionSnapshot,
        signal: request.signal,
      }, { sdk: input.sdk });
      return (async function* () {
        for await (const part of runtimeResult.stream) {
          yield withPromptTrace(part, runtimeResult.promptTraceId);
        }
      })();
    },
  };
}
