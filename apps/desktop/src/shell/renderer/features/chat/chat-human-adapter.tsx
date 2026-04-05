import { useEffect, useMemo, useState } from 'react';
import { createReadyConversationSetupState } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { HumanConversationGiftModal } from '@renderer/features/turns/human-conversation-gift-modal';
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

import {
  ChatRuntimeInspectContent,
  RuntimeInspectCard,
} from './chat-runtime-inspect-content';

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
  const { messages: canonicalMessages, ...transcriptProps } = canonicalSurface.transcriptProps;
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
      interactionState: {
        phase: canonicalSurface.rightSidebarAutoOpenKey ? 'speaking' as const : 'idle' as const,
        busy: Boolean(canonicalSurface.rightSidebarAutoOpenKey),
      },
      theme: {
        roomSurface: 'linear-gradient(180deg, rgba(250,252,252,0.98), rgba(244,247,248,0.96))',
        roomAura: 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(250,245,230,0.82))',
        accentSoft: 'rgba(251,191,36,0.18)',
        accentStrong: '#f59e0b',
        border: 'rgba(251,191,36,0.28)',
        text: '#92400e',
      },
    },
    onSelectThread: (threadId: string) => {
      setSelectedChatId(threadId);
      setChatProfilePanelTarget(null);
    },
    transcriptProps: selectedChatId ? transcriptProps : undefined,
    stagePanelProps: selectedChatId ? stagePanelProps : undefined,
    settingsContent: null,
    settingsDrawerTitle: undefined,
    settingsDrawerSubtitle: undefined,
    composerContent: selectedChatId ? <HumanCanonicalComposer selectedChatId={selectedChatId} /> : null,
    profileContent: profilePanelTarget && selectedChat ? (
      <HumanCanonicalProfileDrawer
        selectedChat={selectedChat}
        onOpenGift={selectedChat.otherUser?.id ? () => setGiftModalOpen(true) : undefined}
      />
    ) : null,
    profileDrawerTitle: t('Chat.profileTitle', { defaultValue: 'Profile' }),
    profileDrawerSubtitle: t('Chat.profileSubtitle', { defaultValue: 'Relationship, memory, and target details.' }),
    rightSidebarContent: selectedChat ? (
      <ChatRuntimeInspectContent
        title={t('Chat.runtimeInspectTitle', { defaultValue: 'Runtime Inspect' })}
        subtitle={t('Chat.runtimeInspectSubtitle', { defaultValue: 'Route, voice, media, and diagnostics for this conversation.' })}
        statusTitle={getHumanChatTitle(selectedChat)}
        statusHint={String(selectedChat.otherUser?.handle || '').trim()
          ? `@${String(selectedChat.otherUser?.handle || '').trim()}`
          : t('Chat.humanBio', { defaultValue: 'Chat with your friends on Nimi.' })}
        statusSummary={t('Chat.mode.human', { defaultValue: 'Human' })}
        statusChips={[
          {
            label: authStatus === 'authenticated'
              ? t('Chat.mode.human', { defaultValue: 'Human' })
              : t('Chat.humanOffline', { defaultValue: 'Offline' }),
            tone: authStatus === 'authenticated' ? 'success' : 'warning',
          },
        ]}
        sections={[
          {
            key: 'chat',
            title: t('Chat.settingsChatModel', { defaultValue: 'Chat Model' }),
            hint: t('Chat.settingsChatModelHint', { defaultValue: 'AI model used for this conversation. Follows Runtime default unless overridden.' }),
            summary: getHumanChatPreview(selectedChat),
            content: (
              <RuntimeInspectCard
                label={t('Chat.mode.human', { defaultValue: 'Human' })}
                value={getHumanChatTitle(selectedChat)}
                detail={canonicalSurface.diagnosticsSummary.isStreaming
                  ? t('Chat.voiceInspectPlaying', { defaultValue: 'Currently playing' })
                  : t('Chat.voiceInspectReady', { defaultValue: 'Ready to play' })}
              />
            ),
          },
          {
            key: 'voice',
            title: t('Chat.settingsVoice', { defaultValue: 'Voice' }),
            hint: t('Chat.settingsVoiceHint', { defaultValue: 'Control how voice replies are triggered, whether voice session mode stays on, and which timbre is used.' }),
            content: canonicalSurface.rightSidebarContent,
            disabledReason: t('Chat.voiceInspectTranscriptHidden', { defaultValue: 'Transcript is hidden until you reveal it.' }),
          },
          {
            key: 'media',
            title: t('Chat.settingsVisuals', { defaultValue: 'Visuals' }),
            hint: t('Chat.settingsVisualsHint', { defaultValue: 'Control whether images and videos appear in conversation, and their content style.' }),
            disabledReason: t('Chat.settingsUnavailableReason', { defaultValue: 'This source does not expose runtime inspect yet.' }),
          },
          {
            key: 'diagnostics',
            title: t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' }),
            hint: t('Chat.profileSubtitle', { defaultValue: 'Relationship, memory, and target details.' }),
            content: (
              <RuntimeInspectCard
                label={t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}
                value={`${canonicalSurface.diagnosticsSummary.messageCount}`}
                detail={canonicalSurface.diagnosticsSummary.isStreaming
                  ? t('ChatTimeline.stopGenerating', 'Stop generating')
                  : t('Chat.voiceInspectReady', { defaultValue: 'Ready to play' })}
              />
            ),
          },
        ]}
        initialOpenPanel={canonicalSurface.rightSidebarAutoOpenKey ? 'voice' : 'chat'}
      />
    ) : null,
    rightSidebarOverlayMenu: canonicalSurface.rightSidebarOverlayMenu,
    rightSidebarResetKey: `${selectedChatId || 'landing'}:${canonicalSurface.rightSidebarAutoOpenKey || 'none'}`,
    rightSidebarAutoOpenKey: canonicalSurface.rightSidebarAutoOpenKey,
    auxiliaryOverlayContent: (
      <HumanConversationGiftModal
        open={giftModalOpen}
        selectedChat={selectedChat}
        onClose={() => setGiftModalOpen(false)}
      />
    ),
    setupDescription: t('Chat.humanSetupRequired', {
      defaultValue: 'Sign in to continue with human conversations.',
    }),
  }), [
    adapter,
    authStatus,
    canonicalMessages,
    canonicalSurface.diagnosticsSummary,
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
    canonicalSurface.rightSidebarAutoOpenKey,
    canonicalSurface.rightSidebarContent,
    canonicalSurface.rightSidebarOverlayMenu,
    transcriptProps,
    targets,
  ]);
}
