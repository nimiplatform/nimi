import type { ConversationRuntimeAdapter } from '@nimiplatform/nimi-kit/features/chat/headless';
import { normalizeConversationRuntimeTextStreamPart } from '@nimiplatform/nimi-kit/features/chat/runtime';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { ChatThinkingPreference } from './chat-thinking';
import { streamChatAiRuntime } from './chat-ai-runtime';
import {
  createAISnapshot,
  type AIConfig,
  type ConversationCapabilityProjection,
} from './conversation-capability';
import {
  peekDesktopAISchedulingForEvidence,
  recordDesktopAISnapshot,
  resolveAIConfigSchedulingTargetForCapability,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import { withPromptTrace } from './chat-ai-shell-core';

export function createChatAiConversationRuntimeAdapter(input: {
  reasoningPreference: ChatThinkingPreference;
  getTextProjection: () => ConversationCapabilityProjection | null;
  aiConfig: AIConfig;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
}): ConversationRuntimeAdapter {
  return {
    async streamText(request) {
      const textProjection = input.getTextProjection();
      const prompt = request.messages[request.messages.length - 1]?.text || '';
      // K-AIEXEC-003: capture scheduling evidence before execution.
      const runtimeEvidence = textProjection?.supported
        ? await peekDesktopAISchedulingForEvidence({
          scopeRef: input.aiConfig.scopeRef,
          target: resolveAIConfigSchedulingTargetForCapability(input.aiConfig, 'text.generate'),
        })
        : null;
      const executionSnapshot = textProjection?.supported
        ? createAISnapshot({
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
        runtimeConfigState: input.runtimeConfigState,
        runtimeFields: input.runtimeFields,
        signal: request.signal,
      });
      return {
        stream: (async function* () {
          for await (const part of runtimeResult.stream) {
            yield withPromptTrace(
              normalizeConversationRuntimeTextStreamPart(part),
              runtimeResult.promptTraceId,
            );
          }
        })(),
      };
    },
  };
}
