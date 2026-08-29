export const AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT =
  'avatar.conversation.voice.audio_chunk';
export const AVATAR_CONVERSATION_VOICE_FAILED_EVENT =
  'avatar.conversation.voice.failed';

export function avatarConversationVoiceSourceId(
  voiceId: string,
  chunkSequence: number,
): string {
  const canonicalVoiceId = voiceId.trim();
  if (!canonicalVoiceId || !Number.isSafeInteger(chunkSequence) || chunkSequence <= 0) {
    throw new Error('Avatar Conversation voice source identity is invalid.');
  }
  return `avatar-conversation-voice://${canonicalVoiceId}/chunks/${String(chunkSequence).padStart(6, '0')}`;
}
