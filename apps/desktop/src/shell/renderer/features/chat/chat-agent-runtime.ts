export {
  CORE_CHAT_AGENT_TARGET_ID,
  type ChatAgentTranscribeRuntimeInvokeDeps,
  type ChatAgentTranscribeRuntimeInvokeInput,
  type ChatAgentTranscribeRuntimeInvokeResult,
  type ChatAgentVoiceWorkflowReferenceAudio,
} from './chat-agent-runtime-types';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message';
export { streamChatAgentRuntimeAgentTurn } from './chat-agent-runtime-agent';
export { transcribeChatAgentVoiceRuntime } from './chat-agent-voice-transcribe-runtime';

export function toChatAgentRuntimeError(error: unknown): { code: string; message: string } {
  return toChatUserFacingRuntimeError(error, 'Agent response failed');
}
