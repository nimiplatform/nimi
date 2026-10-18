import { observeLocalAppConversation, createCanonicalConversationMediaReader, type CanonicalConversationProjection } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationClient } from '@nimiplatform/sdk/app';
import type { ZhiyuEvidence } from '../app/evidence';
import { projectZhiyuConversation } from './agent-conversation-state';

export function subscribeZhiyuAmbientConversation(input: {
  conversation: NimiLocalAppConversationClient;
  identity: { agentHandle: NimiLocalAppAgentHandle; conversationAnchorId: string };
  onChat: (chat: ZhiyuEvidence['chat']) => void;
  onStatus?: (status: 'loading' | 'ready' | 'error', error?: unknown) => void;
}) {
  let projection: CanonicalConversationProjection | null = null;
  const publish = () => {
    if (projection) input.onChat(projectZhiyuConversation({ ...input.identity, projection, media }));
  };
  const media = createCanonicalConversationMediaReader({ conversation: input.conversation, scope: input.identity, onChange: publish });
  const observation = observeLocalAppConversation({
    conversation: input.conversation, scope: input.identity,
    onProjection: value => { projection = value; publish(); },
    onStatus: input.onStatus,
  });
  return { refresh: observation.refresh, close() { observation.close(); media.close(); } };
}
