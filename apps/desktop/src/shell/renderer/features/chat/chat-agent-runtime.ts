import { AgentSubmissionSaveError } from '@nimiplatform/kit/features/chat/headless';
import { chatRuntimeReasonCodeMessage, toChatUserFacingRuntimeError } from './chat-runtime-error-message';
import type { TFunction } from 'i18next';
export { streamChatAgentRuntimeAgentTurn } from './chat-agent-runtime-agent';

export function toChatAgentRuntimeError(error: unknown, t: TFunction): { code: string; message: string } {
  if (error instanceof AgentSubmissionSaveError) {
    return { code: error.reasonCode || '', message: t(error.reasonCode === 'APP_STORAGE_QUOTA_EXCEEDED'
      ? 'Chat.agentSubmissionSaveLimit' : 'Chat.agentSubmissionSaveFailed') };
  }
  return toChatUserFacingRuntimeError(error, 'Agent response failed', t, { localAgent: true });
}

export function localAgentReplyFailureMessage(reasonCode: string, terminalReason: string, t: TFunction): string {
  if (terminalReason === 'user_cancel') return t('Chat.agentReplyStopped');
  if (terminalReason === 'length') return t('Chat.agentReplyLengthLimited');
  return chatRuntimeReasonCodeMessage(reasonCode, t, { localAgent: true }) || t('Chat.agentReplyIncomplete');
}
