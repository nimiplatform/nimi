import type { ZhiyuRuntimeAgentChatStatus, ZhiyuEvidence } from './evidence';

export function turnStatusFromChat(chat: ZhiyuRuntimeAgentChatStatus): ZhiyuEvidence['turn'] {
  const latestAssistant = [...chat.messages].reverse().find(message => message.role === 'agent' || message.role === 'assistant');
  return {
    transport: 'electron-ipc',
    ready: chat.ready,
    reasonCode: chat.reasonCode,
    actionHint: chat.actionHint,
    source: chat.source,
    message: chat.message,
    agentHandle: chat.agentHandle,
    conversationAnchorId: chat.conversationAnchorId,
    requestId: chat.requestId,
    runtimeTurnId: chat.runtimeTurnId,
    runtimeStreamId: chat.runtimeStreamId,
    messageId: latestAssistant ? latestAssistant.id : null,
  };
}
