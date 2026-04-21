import type {
  ConversationRuntimeTextStreamPart,
} from '@nimiplatform/nimi-kit/features/chat';
import { normalizeConversationRuntimeTextStreamPart } from '@nimiplatform/nimi-kit/features/chat/runtime';
import {
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntimeAgentTurn,
  submitChatAgentVoiceWorkflowRuntime,
  streamChatAgentRuntime,
  synthesizeChatAgentVoiceRuntime,
} from './chat-agent-runtime';
import { normalizeText } from './chat-agent-orchestration-shared';
import type {
  AgentLocalChatImageRequest,
  AgentLocalChatRuntimeAdapter,
  AgentLocalChatVoiceRequest,
  AgentLocalChatVoiceWorkflowRequest,
} from './chat-agent-orchestration';

export function createAgentLocalChatConversationRuntimeAdapter(): AgentLocalChatRuntimeAdapter {
  return {
    async streamAgentTurn(request) {
      return streamChatAgentRuntimeAgentTurn(request);
    },
    async streamText(request) {
      const result = await streamChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        history: request.history,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        maxOutputTokensRequested: request.maxOutputTokensRequested,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        agentResolution: request.agentResolution,
        executionSnapshot: request.textExecutionSnapshot,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
      return {
        stream: normalizeAgentLocalRuntimeStream(result.stream, result.promptTraceId),
      };
    },
    async invokeText(request) {
      return invokeChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        history: request.history,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        maxOutputTokensRequested: request.maxOutputTokensRequested,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        agentResolution: request.agentResolution,
        executionSnapshot: request.textExecutionSnapshot,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
    },
    async generateImage(request: AgentLocalChatImageRequest) {
      return generateChatAgentImageRuntime(request);
    },
    async synthesizeVoice(request: AgentLocalChatVoiceRequest) {
      return synthesizeChatAgentVoiceRuntime(request);
    },
    async submitVoiceWorkflow(request: AgentLocalChatVoiceWorkflowRequest) {
      return submitChatAgentVoiceWorkflowRuntime(request);
    },
  };
}

async function* normalizeAgentLocalRuntimeStream(
  stream: AsyncIterable<Awaited<ReturnType<typeof streamChatAgentRuntime>>['stream'] extends AsyncIterable<infer T> ? T : never>,
  promptTraceId: string,
): AsyncIterable<ConversationRuntimeTextStreamPart> {
  for await (const part of stream) {
    const normalizedPart = normalizeConversationRuntimeTextStreamPart(part);
    switch (normalizedPart.type) {
      case 'finish':
        yield {
          ...normalizedPart,
          trace: {
            ...normalizedPart.trace,
            promptTraceId: normalizeText(normalizedPart.trace?.promptTraceId)
              || normalizeText(promptTraceId)
              || null,
          },
        };
        break;
      case 'error':
        yield {
          ...normalizedPart,
          trace: {
            ...normalizedPart.trace,
            promptTraceId: normalizeText(normalizedPart.trace?.promptTraceId)
              || normalizeText(promptTraceId)
              || null,
          },
        };
        break;
      default:
        yield normalizedPart;
    }
  }
}
