import { toChatUserFacingRuntimeError } from './chat-runtime-error-message';
import type { TFunction } from 'i18next';
export { streamChatAgentRuntimeAgentTurn } from './chat-agent-runtime-agent';

export function toChatAgentRuntimeError(error: unknown, t: TFunction): { code: string; message: string } {
  return toChatUserFacingRuntimeError(error, 'Agent response failed', t);
}
