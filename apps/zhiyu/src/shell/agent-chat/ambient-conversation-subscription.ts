import { observeLocalAppConversation, createCanonicalConversationMediaReader, isLocalAppConversationAccessDenied, type CanonicalConversationProjection, type LocalAppConversationObservation } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationClient } from '@nimiplatform/sdk/app';
import { createInitialZhiyuEvidence, type ZhiyuEvidence } from '../app/evidence';
import { projectZhiyuConversation } from './agent-conversation-state';

export function subscribeZhiyuAmbientConversation(input: {
  conversation: NimiLocalAppConversationClient;
  identity: { agentHandle: NimiLocalAppAgentHandle; conversationAnchorId: string };
  onChat: (chat: ZhiyuEvidence['chat']) => void;
  onStatus?: (status: 'loading' | 'ready' | 'error', error?: unknown) => void;
}) {
  let projection: CanonicalConversationProjection | null = null;
  let media: ReturnType<typeof createCanonicalConversationMediaReader> | null = null;
  let observation: LocalAppConversationObservation | null = null;
  let closed = false;
  const publish = () => {
    if (!closed && projection && media) input.onChat({
      ...projectZhiyuConversation({ ...input.identity, projection, media }),
      mediaReadError: media.getReadError(),
    });
  };
  const freshMedia = () => createCanonicalConversationMediaReader({ conversation: input.conversation, scope: input.identity, onChange: publish,
    onAccessDenied: error => observation?.invalidateAccess(error) });
  media = freshMedia();
  observation = observeLocalAppConversation({
    conversation: input.conversation, scope: input.identity,
    onProjection: value => { if (closed) return; if (!media) media = freshMedia(); projection = value; publish(); },
    onStatus: (status, error) => {
      if (closed) return;
      if (status === 'error' && isLocalAppConversationAccessDenied(error)) {
        projection = null;
        media?.close(); media = null;
        // This is an unavailable view, never a fabricated empty owner snapshot.
        input.onChat(createInitialZhiyuEvidence().chat);
      }
      input.onStatus?.(status, error);
    },
  });
  return {
    refresh: observation.refresh,
    invalidateAccess: observation.invalidateAccess,
    retryMedia: () => media?.retryFailed(),
    close() { closed = true; observation?.close(); media?.close(); media = null; projection = null; },
  };
}
