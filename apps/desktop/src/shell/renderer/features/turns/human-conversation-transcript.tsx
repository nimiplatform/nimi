import { useEffect, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  useRealmMessageTimeline,
  type RealmChatOutboxEntryLike,
  type RealmChatTimelineMessage,
} from '@nimiplatform/nimi-kit/features/chat/realm';
import {
  ChatPanelState,
  ChatStreamStatus,
  ChatThreadHeader,
  RealmChatTimeline,
} from '@nimiplatform/nimi-kit/features/chat/ui';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { GiftMessageBubble, type GiftMessagePayload } from '@renderer/features/economy/gift-message-bubble.js';
import type { HumanChatViewDto } from '@renderer/features/chat/chat-human-thread-model';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { useChatUploadPlaceholders } from './chat-upload-placeholder-store';
import { cancelStream, getStreamState, subscribeStream, type StreamState } from './stream-controller';

type MessageViewDto = RealmModel<'MessageViewDto'>;
type ProfilePanelTarget = 'self' | 'other' | null;

type HumanConversationTranscriptProps = {
  selectedChatId: string;
  selectedChat: HumanChatViewDto | null;
};

function useStreamState(chatId: string | null): StreamState | null {
  const [state, setState] = useState<StreamState | null>(() =>
    chatId ? getStreamState(chatId) : null,
  );

  useEffect(() => {
    if (!chatId) {
      setState(null);
      return;
    }
    setState(getStreamState(chatId));
    return subscribeStream(chatId, (updated) => {
      setState({ ...updated });
    });
  }, [chatId]);

  return state;
}

export function HumanConversationTranscript({
  selectedChatId,
  selectedChat,
}: HumanConversationTranscriptProps) {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const authToken = useAppStore((state) => String(state.auth.token || ''));
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');
  const currentUserAvatarUrl = typeof currentUser?.avatarUrl === 'string' ? currentUser.avatarUrl : null;
  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const setProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const streamState = useStreamState(selectedChatId);
  const isStreaming = streamState?.phase === 'waiting' || streamState?.phase === 'streaming';
  const uploadPlaceholders = useChatUploadPlaceholders(selectedChatId);
  const otherUser = selectedChat?.otherUser;
  const contactName = String(otherUser?.displayName || otherUser?.handle || 'Chat').trim();
  const contactAvatarUrl = otherUser?.avatarUrl || null;

  const messagesQuery = useQuery({
    queryKey: ['messages', selectedChatId],
    queryFn: async () => dataSync.loadMessages(selectedChatId),
    enabled: authStatus === 'authenticated' && Boolean(selectedChatId),
  });

  const messages = useRealmMessageTimeline({
    messagesData: messagesQuery.data as { items?: readonly MessageViewDto[]; offlineOutbox?: readonly RealmChatOutboxEntryLike[] } | undefined,
    currentUserId,
    uploadPlaceholders,
  }) as readonly RealmChatTimelineMessage[];

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.id, selectedChatId]);

  const toggleProfilePanel = (target: Exclude<ProfilePanelTarget, null>) => {
    setProfilePanelTarget(profilePanelTarget === target ? null : target);
  };

  if (messagesQuery.isPending) {
    return (
      <ChatPanelState dataTestId={E2E_IDS.messageTimeline} activeChatId={selectedChatId}>
        {t('ChatTimeline.loadingMessages')}
      </ChatPanelState>
    );
  }

  if (messagesQuery.isError) {
    return (
      <ChatPanelState dataTestId={E2E_IDS.messageTimeline} activeChatId={selectedChatId} tone="error">
        {t('ChatTimeline.messageLoadError')}
      </ChatPanelState>
    );
  }

  return (
    <div
      data-testid={E2E_IDS.messageTimeline}
      data-active-chat-id={selectedChatId}
      className="flex min-h-0 flex-col"
    >
      <div className="-mx-4 -mt-4 mb-4">
        <ChatThreadHeader
          title={contactName}
          onTitleClick={() => toggleProfilePanel('other')}
          titleAriaLabel={profilePanelTarget === 'other'
            ? t('ChatTimeline.collapseUserProfile')
            : t('ChatTimeline.viewUserProfile')}
          titleClassName=""
          className="bg-white"
        />
      </div>

      <div className="space-y-4">
        <RealmChatTimeline
          messages={messages}
          currentUserId={currentUserId}
          realmBaseUrl={realmBaseUrl}
          authToken={authToken}
          emptyState={<p className="text-center text-sm text-gray-500">{t('Chat.noMessages')}</p>}
          emptyMessageLabel={t('ChatTimeline.emptyMessage')}
          imageMessageLabel={t('ChatTimeline.imageMessage', 'Image')}
          videoMessageLabel={t('ChatTimeline.videoMessage', 'Video')}
          queuedLocallyLabel={t('ChatTimeline.queuedLocally')}
          sendFailedLabel={t('ChatTimeline.sendFailed')}
          uploadingMediaLabel={t('ChatTimeline.uploadingMedia', 'Uploading...')}
          yesterdayLabel={t('Chat.yesterday', { defaultValue: 'Yesterday' })}
          renderAvatar={({ display, isMe }) => {
            const senderName = isMe ? t('ChatTimeline.you') : contactName;
            const messageProfileTarget: Exclude<ProfilePanelTarget, null> = isMe ? 'self' : 'other';
            return (
              <button
                type="button"
                onClick={() => toggleProfilePanel(messageProfileTarget)}
                className={`${display.isMediaMessage || display.isGiftMessage ? 'mt-0' : 'mt-1'} shrink-0`}
                aria-label={profilePanelTarget === messageProfileTarget
                  ? (isMe ? t('ChatTimeline.collapseMyProfile') : t('ChatTimeline.collapseUserProfile'))
                  : (isMe ? t('ChatTimeline.viewMyProfile') : t('ChatTimeline.viewUserProfile'))}
              >
                <EntityAvatar
                  imageUrl={isMe ? currentUserAvatarUrl : contactAvatarUrl}
                  name={senderName}
                  kind="human"
                  sizeClassName="h-8 w-8"
                  textClassName="text-xs font-medium"
                  fallbackClassName={isMe ? 'bg-[#0066CC] text-white' : undefined}
                />
              </button>
            );
          }}
          renderGiftMessage={({ message, isMe }) => (
            <GiftMessageBubble
              payload={message.payload as unknown as GiftMessagePayload}
              isMe={isMe}
              currentUserId={currentUserId}
            />
          )}
        />

        {streamState && isStreaming ? (
          <ChatStreamStatus
            mode="streaming"
            partialText={streamState.partialText}
            avatar={(
              <EntityAvatar
                imageUrl={contactAvatarUrl}
                name={contactName}
                kind="human"
                sizeClassName="mt-1 h-8 w-8 shrink-0"
                textClassName="text-xs font-medium"
              />
            )}
            actions={(
              <button
                type="button"
                onClick={() => cancelStream(selectedChatId)}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
              >
                {t('ChatTimeline.stopGenerating', 'Stop generating')}
              </button>
            )}
          />
        ) : null}

        {streamState && (streamState.phase === 'error' || streamState.phase === 'cancelled') && streamState.interrupted ? (
          <ChatStreamStatus
            mode="interrupted"
            partialText={streamState.partialText}
            errorMessage={streamState.errorMessage}
            avatar={(
              <EntityAvatar
                imageUrl={contactAvatarUrl}
                name={contactName}
                kind="human"
                sizeClassName="mt-1 h-8 w-8 shrink-0"
                textClassName="text-xs font-medium"
              />
            )}
            interruptedSuffix={<span className="ml-1 text-xs text-red-400">[{t('ChatTimeline.streamInterrupted', 'Response interrupted')}]</span>}
          />
        ) : null}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
