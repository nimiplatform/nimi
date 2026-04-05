import { useEffect, useMemo, useState } from 'react';
import { createReadyConversationSetupState } from '@nimiplatform/nimi-kit/features/chat/headless';
import { getRealmChatTimelineDisplayModel, useRealmMessageTimeline, type RealmChatOutboxEntryLike } from '@nimiplatform/nimi-kit/features/chat/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { HumanConversationGiftModal } from '@renderer/features/turns/human-conversation-gift-modal';
import { useChatUploadPlaceholders } from '@renderer/features/turns/chat-upload-placeholder-store';
import {
  compareHumanChatsByRecency,
  collapseHumanChatsToTargets,
  getHumanChatPreview,
  getHumanTargetId,
  getHumanChatTitle,
  resolveCanonicalHumanChatId,
  toHumanConversationThreadSummary,
  type HumanChatViewDto,
} from './chat-human-thread-model';
import {
  HumanCanonicalComposer,
  HumanCanonicalProfileDrawer,
  useHumanCanonicalConversationSurface,
} from './chat-human-canonical-components';
import type { DesktopConversationModeHost } from './chat-mode-host-types';

type MessageViewDto = RealmModel<'MessageViewDto'>;

type UseHumanConversationModeHostInput = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  selectedChatId: string | null;
  setSelectedChatId: (chatId: string | null) => void;
  setChatProfilePanelTarget: (target: 'self' | 'other' | null) => void;
};

export function useHumanConversationModeHost(
  input: UseHumanConversationModeHostInput,
): DesktopConversationModeHost {
  const {
    authStatus,
    selectedChatId,
    setSelectedChatId,
    setChatProfilePanelTarget,
  } = input;
  const { t } = useTranslation();
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const currentUserId = String(useAppStore((state) => state.auth.user?.id) || '');
  const chatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => dataSync.loadChats(),
    enabled: authStatus === 'authenticated',
  });

  const allChats = ((chatsQuery.data as { items?: HumanChatViewDto[] } | undefined)?.items || []) as HumanChatViewDto[];
  const allChatsSorted = useMemo(
    () => [...allChats].sort(compareHumanChatsByRecency),
    [allChats],
  );
  const collapsedChats = useMemo(
    () => collapseHumanChatsToTargets(allChatsSorted),
    [allChatsSorted],
  );
  const threads = useMemo(
    () => collapsedChats.map((chat) => toHumanConversationThreadSummary(chat)),
    [collapsedChats],
  );
  const chatById = useMemo(
    () => new Map(allChats.map((chat) => [String(chat.id || ''), chat])),
    [allChats],
  );
  const selectedChat = selectedChatId ? chatById.get(String(selectedChatId)) || null : null;
  const selectedChatTitle = selectedChat ? getHumanChatTitle(selectedChat) : t('Chat.humanTitle', { defaultValue: 'Human Chat' });
  const uploadPlaceholders = useChatUploadPlaceholders(selectedChatId);
  const messagesQuery = useQuery({
    queryKey: ['messages', selectedChatId],
    queryFn: async () => selectedChatId ? dataSync.loadMessages(selectedChatId) : null,
    enabled: authStatus === 'authenticated' && Boolean(selectedChatId),
  });
  const timelineMessages = useRealmMessageTimeline({
    messagesData: messagesQuery.data as { items?: readonly MessageViewDto[]; offlineOutbox?: readonly RealmChatOutboxEntryLike[] } | null | undefined,
    currentUserId,
    uploadPlaceholders,
  });
  const canonicalMessages = useMemo(
    () => timelineMessages.map((message) => {
      const display = getRealmChatTimelineDisplayModel(message, currentUserId);
      return {
        id: String(message.id || message.clientMessageId || ''),
        sessionId: String(selectedChatId || ''),
        targetId: selectedChat ? getHumanTargetId(selectedChat) : String(selectedChatId || ''),
        source: 'human' as const,
        role: display.isMe ? 'human' as const : 'assistant' as const,
        text: display.resolvedText || '',
        createdAt: String(message.createdAt || ''),
        updatedAt: String(message.editedAt || message.createdAt || ''),
        status: display.deliveryState === 'pending'
          ? 'pending' as const
          : display.deliveryState === 'failed'
            ? 'error' as const
            : 'complete' as const,
        error: display.deliveryError,
        kind: display.isGiftMessage
          ? 'system' as const
          : display.isImageMessage
            ? 'image' as const
            : display.isVideoMessage
              ? 'video' as const
              : 'text' as const,
        metadata: {
          realmMessage: message,
        },
      };
    }),
    [currentUserId, selectedChat, selectedChatId, timelineMessages],
  );
  const targets = useMemo(
    () => collapsedChats.map((chat) => ({
      id: getHumanTargetId(chat),
      source: 'human' as const,
      canonicalSessionId: String(chat.id || ''),
      title: getHumanChatTitle(chat),
      handle: String(chat.otherUser?.handle || '').trim()
        ? `@${String(chat.otherUser?.handle || '').trim()}`
        : null,
      bio: null,
      avatarUrl: String(chat.otherUser?.avatarUrl || '').trim() || null,
      avatarFallback: getHumanChatTitle(chat).charAt(0).toUpperCase() || 'H',
      previewText: getHumanChatPreview(chat),
      updatedAt: String(chat.lastMessageAt || chat.lastMessage?.createdAt || chat.createdAt || ''),
      unreadCount: Number(chat.unreadCount || 0),
      status: 'active' as const,
      isOnline: null,
      metadata: {
        otherUserId: getHumanTargetId(chat),
      },
    })),
    [collapsedChats],
  );
  const canonicalSurface = useHumanCanonicalConversationSurface({
    selectedChatId,
    selectedChat,
    characterData: {
      avatarUrl: String(selectedChat?.otherUser?.avatarUrl || '').trim() || undefined,
      avatarFallback: selectedChatTitle.charAt(0).toUpperCase() || 'H',
      name: selectedChatTitle,
      bio: null,
    },
  });
  const { messages: _humanTranscriptMessages, ...transcriptProps } = canonicalSurface.transcriptProps;
  const {
    messages: _humanStageMessages,
    characterData: _humanStageCharacterData,
    anchorViewportRef: _humanStageAnchorViewportRef,
    cardAnchorOffsetPx: _humanStageCardAnchorOffsetPx,
    onIntentOpenHistory: _humanStageOnIntentOpenHistory,
    ...stagePanelProps
  } = canonicalSurface.stagePanelProps;

  useEffect(() => {
    if (!selectedChatId) {
      return;
    }
    const exists = allChats.some((chat) => String(chat.id || '') === String(selectedChatId));
    if (!exists) {
      setSelectedChatId(null);
      setChatProfilePanelTarget(null);
    }
  }, [allChats, selectedChatId, setChatProfilePanelTarget, setSelectedChatId]);

  useEffect(() => {
    setGiftModalOpen(false);
  }, [selectedChatId]);

  const setupState = useMemo(() => {
    if (authStatus === 'authenticated') {
      return createReadyConversationSetupState('human');
    }
    return {
      mode: 'human' as const,
      status: 'setup-required' as const,
      issues: [{ code: 'human-auth-required' as const }],
      primaryAction: {
        kind: 'sign-in' as const,
        returnToMode: 'human' as const,
      },
    };
  }, [authStatus]);

  const adapter = useMemo(() => ({
    mode: 'human' as const,
    setupState,
    threadAdapter: {
      listThreads: () => threads,
      listMessages: () => [],
    },
    composerAdapter: {
      submit: async () => undefined,
      placeholder: t('TurnInput.typeMessage', { defaultValue: 'Type a message...' }),
    },
  }), [setupState, t, threads]);

  return useMemo(() => ({
    mode: 'human',
    availability: {
      mode: 'human',
      label: t('Chat.mode.human', { defaultValue: 'Human' }),
      enabled: true,
      badge: threads.length > 0 ? threads.length : null,
      disabledReason: null,
    },
    adapter,
    activeThreadId: selectedChatId,
    targets,
    selectedTargetId: selectedChat ? getHumanTargetId(selectedChat) : null,
    messages: canonicalMessages,
    onSelectTarget: (targetId) => {
      setSelectedChatId(resolveCanonicalHumanChatId(allChats, targetId));
      setChatProfilePanelTarget(null);
    },
    characterData: {
      avatarUrl: String(selectedChat?.otherUser?.avatarUrl || '').trim() || undefined,
      name: selectedChat ? getHumanChatTitle(selectedChat) : t('Chat.humanTitle', { defaultValue: 'Human Chat' }),
      avatarFallback: selectedChat ? getHumanChatTitle(selectedChat).charAt(0).toUpperCase() || 'H' : 'H',
      handle: String(selectedChat?.otherUser?.handle || '').trim()
        ? `@${String(selectedChat?.otherUser?.handle || '').trim()}`
        : null,
      bio: selectedChat
        ? null
        : t('Chat.humanBio', { defaultValue: 'Chat with your friends on Nimi.' }),
      presenceLabel: authStatus === 'authenticated'
        ? t('Chat.mode.human', { defaultValue: 'Human' })
        : t('Chat.humanOffline', { defaultValue: 'Offline' }),
      presenceBusy: false,
      theme: {
        roomSurface: 'linear-gradient(180deg, rgba(250,252,252,0.98), rgba(244,247,248,0.96))',
        roomAura: 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(250,245,230,0.82))',
        accentSoft: 'rgba(251,191,36,0.18)',
        accentStrong: '#f59e0b',
        border: 'rgba(251,191,36,0.28)',
        text: '#92400e',
      },
      badges: authStatus === 'authenticated'
        ? [{ label: 'Online', variant: 'online' as const, pulse: true }]
        : [],
    },
    onSelectThread: (threadId: string) => {
      setSelectedChatId(threadId);
      setChatProfilePanelTarget(null);
    },
    transcriptProps: selectedChatId ? transcriptProps : undefined,
    stagePanelProps: selectedChatId ? stagePanelProps : undefined,
    composerContent: selectedChatId ? <HumanCanonicalComposer selectedChatId={selectedChatId} /> : null,
    profileContent: profilePanelTarget && selectedChat ? (
      <HumanCanonicalProfileDrawer
        selectedChat={selectedChat}
        onOpenGift={selectedChat.otherUser?.id ? () => setGiftModalOpen(true) : undefined}
      />
    ) : null,
    profileDrawerTitle: t('Chat.profileTitle', { defaultValue: 'Profile' }),
    profileDrawerSubtitle: t('Chat.profileSubtitle', { defaultValue: 'Relationship, memory, and target details.' }),
    rightSidebarOverlayMenu: canonicalSurface.rightSidebarOverlayMenu,
    auxiliaryOverlayContent: (
      <HumanConversationGiftModal
        open={giftModalOpen}
        selectedChat={selectedChat}
        onClose={() => setGiftModalOpen(false)}
      />
    ),
    renderEmptyState: () => (
      <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--nimi-text-muted)]">
        {threads.length > 0
          ? t('Chat.selectConversation', { defaultValue: 'Select a conversation to start chatting.' })
          : t('Chat.noChats', { defaultValue: 'No chats' })}
      </div>
    ),
    renderSetupDescription: () => t('Chat.humanSetupRequired', {
      defaultValue: 'Sign in to continue with human conversations.',
    }),
  }), [
    adapter,
    canonicalMessages,
    chatById,
    giftModalOpen,
    profilePanelTarget,
    selectedChat,
    selectedChatTitle,
    selectedChatId,
    setChatProfilePanelTarget,
    setSelectedChatId,
    stagePanelProps,
    t,
    allChats,
    allChatsSorted,
    canonicalSurface.rightSidebarOverlayMenu,
    transcriptProps,
    targets,
    threads.length,
  ]);
}
