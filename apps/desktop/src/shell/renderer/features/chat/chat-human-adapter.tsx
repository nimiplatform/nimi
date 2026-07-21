import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createReadyConversationSetupState } from '@nimiplatform/kit/features/chat/headless';
import {
  collapseRealmHumanChatsToTargets,
  compareRealmHumanChatsByRecency,
  getRealmHumanChatTitle,
  getRealmHumanTargetId,
  resolveCanonicalRealmHumanChatId,
  toRealmHumanConversationThreadSummary,
  toRealmHumanTargetSummary,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HumanConversationGiftModal } from '../turns/human-conversation-gift-modal';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { loadChatList, startChatWithTarget } from './data/realm-human-chat-data';
import {
  HumanCanonicalComposer,
  HumanCanonicalProfileDrawer,
  useHumanCanonicalConversationSurface,
} from './chat-human-canonical-components';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import type { AuthStatus } from '../../app-shell/providers/app-store';

import {
  ChatRuntimeInspectContent,
  RuntimeInspectCard,
  RuntimeInspectUnsupportedNote,
} from './chat-runtime-inspect-content';

const ChatSettingsPanel = lazy(async () => {
  const mod = await import('./chat-shared-settings-panel');
  return { default: mod.ChatSettingsPanel };
});

type UseHumanConversationModeHostInput = {
  authStatus: AuthStatus;
  selectedChatId: string | null;
  setSelectedChatId: (chatId: string | null) => void;
  setChatProfilePanelTarget: (target: 'self' | 'other' | null) => void;
};

function formatHumanChatTime(
  isoString: string | null | undefined,
  i18n: DesktopI18nResource,
): string {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const diffMs = i18n.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) {
    return i18n.formatRelativeTime(date);
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return i18n.formatRelativeTime(date);
  }
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) {
    return i18n.formatDate(date, { weekday: 'short' });
  }
  return i18n.formatDate(date, { month: 'short', day: 'numeric' });
}

export function useHumanConversationModeHost(
  input: UseHumanConversationModeHostInput,
): DesktopConversationModeHost {
  const i18n = useDesktopI18nResource();
  const {
    authStatus,
    selectedChatId,
    setSelectedChatId,
    setChatProfilePanelTarget,
  } = input;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const chatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => loadChatList(),
    enabled: authStatus === 'authenticated',
  });

  const noMessagesFallback = t('Chat.noMessages', { defaultValue: 'No messages yet' });
  const unknownTitle = t('Common.unknown', { defaultValue: 'Unknown' });
  const allChats = ((chatsQuery.data as { items?: RealmChatViewDto[] } | undefined)?.items || []) as RealmChatViewDto[];
  const allChatsSorted = useMemo(
    () => [...allChats].sort(compareRealmHumanChatsByRecency),
    [allChats],
  );
  const collapsedChats = useMemo(
    () => collapseRealmHumanChatsToTargets(allChatsSorted),
    [allChatsSorted],
  );
  const projectionOptions = useMemo(() => ({
    noMessagesFallback,
    unknownTitle,
    formatUpdatedAt: ({ timestamp }: { timestamp: string }) => formatHumanChatTime(timestamp, i18n),
  }), [i18n, noMessagesFallback, unknownTitle]);
  const threads = useMemo(
    () => collapsedChats.map((chat) => toRealmHumanConversationThreadSummary(chat, projectionOptions)),
    [collapsedChats, projectionOptions],
  );
  const chatById = useMemo(
    () => new Map(allChats.map((chat) => [String(chat.id || ''), chat])),
    [allChats],
  );
  const selectedChat = selectedChatId ? chatById.get(String(selectedChatId)) || null : null;
  const selectedChatTitle = selectedChat ? getRealmHumanChatTitle(selectedChat, unknownTitle) : t('Chat.humanTitle', { defaultValue: 'Human Chat' });
  const targets = useMemo(
    () => collapsedChats.map((chat) => toRealmHumanTargetSummary(chat, projectionOptions)),
    [collapsedChats, projectionOptions],
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
  const humanRuntimeInspectContent = selectedChat ? (
    <ChatRuntimeInspectContent
      title={t('Chat.settingsTitle', { defaultValue: 'Settings' })}
      subtitle={t('Chat.humanTitle', { defaultValue: 'Human Chat' })}
      statusTitle={t('Chat.mode.human', { defaultValue: 'Human' })}
      statusHint={t('Chat.nimiProfileSubtitle', {
        defaultValue: 'Route, target, and conversation details.',
      })}
      statusSummary={(
        <RuntimeInspectCard
          label={t('Chat.mode.human', { defaultValue: 'Human' })}
          value={getRealmHumanChatTitle(selectedChat, unknownTitle)}
          detail={canonicalSurface.diagnosticsSummary.isStreaming
            ? t('Chat.voiceInspectPlaying', { defaultValue: 'Currently playing' })
            : t('Chat.voiceInspectReady', { defaultValue: 'Ready to play' })}
        />
      )}
      sections={[
        {
          key: 'chat',
          title: t('Chat.settingsChatModel', { defaultValue: 'Chat Model' }),
          hint: t('Chat.settingsChatModelHint', {
            defaultValue: 'AI model used for this conversation. Follows Runtime default unless overridden.',
          }),
          summary: getRealmHumanChatTitle(selectedChat, unknownTitle),
          content: (
            <RuntimeInspectCard
              label={t('Chat.mode.human', { defaultValue: 'Human' })}
              value={getRealmHumanChatTitle(selectedChat, unknownTitle)}
              detail={canonicalSurface.diagnosticsSummary.isStreaming
                ? t('Chat.voiceInspectPlaying', { defaultValue: 'Currently playing' })
                : t('Chat.voiceInspectReady', { defaultValue: 'Ready to play' })}
            />
          ),
        },
        {
          key: 'voice',
          title: t('Chat.settingsVoice', { defaultValue: 'Voice' }),
          hint: t('Chat.settingsVoiceHint', {
            defaultValue: 'Review voice playback, transcript visibility, and route readiness for this conversation.',
          }),
          content: canonicalSurface.rightSidebarContent || (
            <RuntimeInspectUnsupportedNote label={t('Chat.voiceInspectTranscriptHidden', { defaultValue: 'Transcript is hidden until you reveal it.' })} />
          ),
        },
        {
          key: 'diagnostics',
          title: t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' }),
          hint: t('Chat.settingsDiagnosticsHint', {
            defaultValue: 'Inspect route, runtime, and conversation health details for the current chat.',
          }),
          content: (
            <RuntimeInspectCard
              label={t('Chat.diagnosticsSessionLabel', { defaultValue: 'Session' })}
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
  ) : null;
  const profileContent = selectedChat ? (
    <div className="contents">
      <HumanCanonicalProfileDrawer
        selectedChat={selectedChat}
        onOpenGift={() => setGiftModalOpen(true)}
      />
      {humanRuntimeInspectContent}
    </div>
  ) : null;
  const rightSidebarContent = canonicalSurface.rightSidebarContent;
  const rightSidebarOverlayMenu = canonicalSurface.rightSidebarOverlayMenu;
  const rightSidebarAutoOpenKey = canonicalSurface.rightSidebarAutoOpenKey;

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
    composerAdapter: null,
  }), [setupState, threads]);

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
    selectedTargetId: selectedChat ? getRealmHumanTargetId(selectedChat) : null,
    messages: canonicalMessages,
    onSelectTarget: (targetId) => {
      const normalizedTargetId = String(targetId || '').trim();
      const existingChatId = resolveCanonicalRealmHumanChatId(allChats, normalizedTargetId);
      setChatProfilePanelTarget(null);
      if (existingChatId) {
        setSelectedChatId(existingChatId);
        return;
      }
      if (!normalizedTargetId) {
        setSelectedChatId(null);
        return;
      }
      void startChatWithTarget(normalizedTargetId, null)
        .then((result) => {
          const chatId = String(result.chat?.id || result.chatId || '').trim();
          if (!chatId) {
            return;
          }
          setSelectedChatId(chatId);
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        })
        .catch((error) => {
          logRendererEvent({
            level: 'error',
            area: 'chat',
            message: 'action:human-target-start-chat:failed',
            details: {
              targetId: normalizedTargetId,
              error: error instanceof Error ? error.message : String(error || 'unknown'),
            },
          });
        });
    },
    characterData: {
      avatarUrl: String(selectedChat?.otherUser?.avatarUrl || '').trim() || undefined,
      name: selectedChat ? getRealmHumanChatTitle(selectedChat, unknownTitle) : t('Chat.humanTitle', { defaultValue: 'Human Chat' }),
      avatarFallback: selectedChat ? getRealmHumanChatTitle(selectedChat, unknownTitle).charAt(0).toUpperCase() || 'H' : 'H',
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
    profileContent: profileContent,
    rightSidebarContent: rightSidebarContent,
    rightSidebarOverlayMenu: rightSidebarOverlayMenu,
    rightSidebarAutoOpenKey: rightSidebarAutoOpenKey,
    settingsContent: (
      <Suspense fallback={null}>
        {selectedChat ? (
          <ChatSettingsPanel
            mode="human"
            diagnosticsContent={(
              <RuntimeInspectCard
                label={t('Chat.diagnosticsSessionLabel', { defaultValue: 'Session' })}
                value={`${canonicalSurface.diagnosticsSummary.messageCount}`}
                detail={canonicalSurface.diagnosticsSummary.isStreaming
                  ? t('ChatTimeline.stopGenerating', 'Stop generating')
                  : t('Chat.voiceInspectReady', { defaultValue: 'Ready to play' })}
              />
            )}
          />
        ) : (
          <ChatSettingsPanel
            unavailableReason={t('Chat.humanSetupRequired', {
              defaultValue: 'Sign in to continue with human conversations.',
            })}
          />
        )}
      </Suspense>
    ),
    composerContent: selectedChatId ? (
      <HumanCanonicalComposer
        selectedChatId={selectedChatId}
        leadingAvatar={selectedChat ? {
          name: getRealmHumanChatTitle(selectedChat, unknownTitle),
          imageUrl: String(selectedChat.otherUser?.avatarUrl || '').trim() || null,
          fallbackLabel: getRealmHumanChatTitle(selectedChat, unknownTitle).charAt(0).toUpperCase() || 'H',
          targetId: String(selectedChat.otherUser?.id || '').trim() || null,
          handle: String(selectedChat.otherUser?.handle || '').trim() || null,
          worldName: null,
        } : null}
      />
    ) : null,
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
    profileContent,
    rightSidebarAutoOpenKey,
    rightSidebarContent,
    rightSidebarOverlayMenu,
    giftModalOpen,
    humanRuntimeInspectContent,
    selectedChat,
    selectedChatTitle,
    selectedChatId,
    setChatProfilePanelTarget,
    setSelectedChatId,
    stagePanelProps,
    t,
    allChats,
    allChatsSorted,
    transcriptProps,
    targets,
  ]);
}
