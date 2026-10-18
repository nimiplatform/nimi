import { chatRuntimeReasonCodeMessage, toChatUserFacingRuntimeError } from './chat-runtime-error-message';
import type { TFunction } from 'i18next';
export { streamChatAgentRuntimeAgentTurn } from './chat-agent-runtime-agent';

export function toChatAgentRuntimeError(error: unknown, t: TFunction): { code: string; message: string } {
  return toChatUserFacingRuntimeError(error, 'Agent response failed', t, { localAgent: true });
}

export function localAgentReplyFailureMessage(reasonCode: string, terminalReason: string, t: TFunction): string {
  if (terminalReason === 'user_cancel') return t('Chat.agentReplyStopped');
  if (terminalReason === 'length') return t('Chat.agentReplyLengthLimited');
  return chatRuntimeReasonCodeMessage(reasonCode, t, { localAgent: true }) || t('Chat.agentReplyIncomplete');
}
