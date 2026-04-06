import type { ConversationRuntimeAdapter } from '@nimiplatform/nimi-kit/features/chat/headless';
import { normalizeConversationRuntimeTextStreamPart } from '@nimiplatform/nimi-kit/features/chat/runtime';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { ChatThinkingPreference } from './chat-thinking';
import { streamChatAiRuntime } from './chat-ai-runtime';
import {
  createConversationExecutionSnapshot,
  type ConversationCapabilityProjection,
} from './conversation-capability';
import { withPromptTrace } from './chat-ai-shell-core';

export function createChatAiConversationRuntimeAdapter(input: {
  threadId: string;
  reasoningPreference: ChatThinkingPreference;
  textProjection: ConversationCapabilityProjection | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
}): ConversationRuntimeAdapter {
  return {
    async streamText(request) {
      const prompt = request.messages[request.messages.length - 1]?.text || '';
      const executionSnapshot = input.textProjection?.supported
        ? createConversationExecutionSnapshot({
          capability: 'text.generate',
          projection: input.textProjection,
        })
        : null;
      const runtimeResult = await streamChatAiRuntime({
        prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        threadId: input.threadId,
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
