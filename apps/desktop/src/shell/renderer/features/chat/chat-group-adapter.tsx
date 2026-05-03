import { useCallback, useEffect, useMemo, useState } from 'react';
import { createReadyConversationSetupState } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { ConversationCanonicalMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { GROUP_CREATE_INTENT_TARGET_ID } from './chat-group-flow-constants';
import { ChatGroupParticipantPanel } from './chat-group-participant-panel';
import { ChatGroupComposer } from './chat-group-composer';
import { ChatGroupCreateModal } from './chat-group-create-modal';
import {
  compareGroupChatsByRecency,
  getGroupChatTitle,
  getGroupParticipantCount,
  toGroupConversationThreadSummary,
  toGroupTargetSummary,
  groupMessageToCanonical,
  type GroupChatViewDto,
  type GroupMessageViewDto,
  type GroupParticipantDto,
} from './chat-group-thread-model';

const GROUP_CHATS_QUERY_KEY = ['group-chats'] as const;

type UseGroupConversationModeHostInput = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  currentUserId: string | null;
};

export function useGroupConversationModeHost(
  input: UseGroupConversationModeHostInput,
): DesktopConversationModeHost {
  const { authStatus, currentUserId } = input;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const setLastSelectedThreadForMode = useAppStore((state) => state.setLastSelectedThreadForMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.group ?? null);
  const selectedGroupId = storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID
    ? null
    : storeSelectedTargetId;

  const groupChatsQuery = useQuery({
    queryKey: [...GROUP_CHATS_QUERY_KEY, authStatus],
    queryFn: async () => dataSync.loadGroupChats(),
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const allGroups = useMemo(() => {
    const items = (groupChatsQuery.data as { items?: GroupChatViewDto[] } | undefined)?.items || [];
    return [...items].sort(compareGroupChatsByRecency);
  }, [groupChatsQuery.data]);

  const groupById = useMemo(
    () => new Map(allGroups.map((g) => [String(g.id || ''), g])),
    [allGroups],
  );

  const selectedGroup = selectedGroupId ? groupById.get(selectedGroupId) || null : null;

  const messagesQuery = useQuery({
    queryKey: ['group-messages', selectedGroupId],
    queryFn: async () => {
      if (!selectedGroupId) return { items: [] };
      const result = await dataSync.loadGroupMessages(selectedGroupId);
      void dataSync.markGroupRead(selectedGroupId);
      return result;
    },
    enabled: Boolean(selectedGroupId) && authStatus === 'authenticated',
    staleTime: 10_000,
  });

  const canonicalMessages: ConversationCanonicalMessage[] = useMemo(() => {
    const items = (messagesQuery.data as { items?: GroupMessageViewDto[] } | undefined)?.items || [];
    return [...items]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((msg) => groupMessageToCanonical(msg, currentUserId));
  }, [messagesQuery.data, currentUserId]);

  const threads = useMemo(
    () => allGroups.map(toGroupConversationThreadSummary),
    [allGroups],
  );

  const targets = useMemo(
    () => allGroups.map(toGroupTargetSummary),
    [allGroups],
  );

  const sendMutation = useMutation({
    mutationFn: async ({ chatId, content }: { chatId: string; content: string }) => {
      return dataSync.sendGroupMessage(chatId, content);
    },
    onSuccess: (_sentMessage, variables) => {
      const sentChatId = String(variables.chatId || '');
      if (sentChatId) {
        void queryClient.invalidateQueries({ queryKey: ['group-messages', sentChatId] });
      }
      void queryClient.invalidateQueries({ queryKey: GROUP_CHATS_QUERY_KEY });
    },
  });

  useEffect(() => {
    if (!selectedGroupId) {
      return;
    }
    setLastSelectedThreadForMode('group', selectedGroupId);
  }, [selectedGroupId, setLastSelectedThreadForMode]);

  useEffect(() => {
    if (!selectedGroupId) {
      return;
    }
    const exists = allGroups.some((group) => String(group.id || '') === selectedGroupId);
    if (!exists) {
      setSelectedTargetForSource('group', null);
    }
  }, [allGroups, selectedGroupId, setSelectedTargetForSource]);

  const setupState = useMemo(() => {
    if (authStatus === 'authenticated') {
      return createReadyConversationSetupState('group');
    }
    return {
      mode: 'group' as const,
      status: 'setup-required' as const,
      issues: [{ code: 'human-auth-required' as const }],
      primaryAction: {
        kind: 'sign-in' as const,
        returnToMode: 'group' as const,
      },
    };
  }, [authStatus]);

  const adapter = useMemo(() => ({
    mode: 'group' as const,
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

  const handleSelectTarget = useCallback((targetId: string | null) => {
    setSelectedTargetForSource('group', targetId);
  }, [setSelectedTargetForSource]);

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedGroupId || !content.trim()) return;
    await sendMutation.mutateAsync({ chatId: selectedGroupId, content: content.trim() });
  }, [selectedGroupId, sendMutation]);

  const handleCreateGroup = useCallback(async (title: string, participantIds: string[]) => {
    const result = await dataSync.createGroup(title, participantIds);
    void queryClient.invalidateQueries({ queryKey: GROUP_CHATS_QUERY_KEY });
    setCreateModalOpen(false);
    if (result && typeof result === 'object' && 'id' in result) {
      setSelectedTargetForSource('group', String((result as { id: string }).id));
    }
  }, [queryClient, setSelectedTargetForSource]);

  const selectedGroupTitle = selectedGroup
    ? getGroupChatTitle(selectedGroup)
    : t('Chat.group', { defaultValue: 'Group' });

  const participants: GroupParticipantDto[] = selectedGroup?.participants || [];

  return useMemo((): DesktopConversationModeHost => ({
    mode: 'group',
    availability: {
      mode: 'group',
      label: t('Chat.mode.group', { defaultValue: 'Group' }),
      enabled: true,
      badge: allGroups.length > 0 ? allGroups.length : null,
      disabledReason: null,
    },
    adapter,
    activeThreadId: selectedGroupId,
    targets,
    selectedTargetId: selectedGroupId,
    messages: canonicalMessages,
    onSelectTarget: handleSelectTarget,
    onSelectThread: (threadId: string) => setSelectedTargetForSource('group', threadId),
    characterData: {
      name: selectedGroupTitle,
      avatarFallback: selectedGroupTitle.charAt(0).toUpperCase() || 'G',
      handle: selectedGroup
        ? `${getGroupParticipantCount(selectedGroup)} ${t('Chat.groupMembers', { defaultValue: 'members' })}`
        : null,
      bio: selectedGroup
        ? null
        : t('Chat.groupBio', { defaultValue: 'Create or join group conversations.' }),
      theme: {
        roomSurface: 'linear-gradient(180deg, rgba(248,250,255,0.98), rgba(240,244,252,0.96))',
        roomAura: 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(230,240,255,0.82))',
        accentSoft: 'rgba(99,102,241,0.14)',
        accentStrong: '#6366f1',
        border: 'rgba(99,102,241,0.25)',
        text: '#3730a3',
      },
    },
    rightPanelContent: selectedGroup ? (
      <ChatGroupParticipantPanel
        participants={participants}
        currentUserId={currentUserId}
        chatId={selectedGroupId}
        embedded
        onAgentSlotChanged={() => {
          if (selectedGroupId) {
            void queryClient.invalidateQueries({ queryKey: ['group-chats'] });
            void queryClient.invalidateQueries({ queryKey: ['group-messages', selectedGroupId] });
          }
        }}
      />
    ) : null,
    composerContent: selectedGroupId ? (
      <ChatGroupComposer
        selectedGroupId={selectedGroupId}
        onSendMessage={handleSendMessage}
        isSending={sendMutation.isPending}
      />
    ) : null,
    auxiliaryOverlayContent: (
      <ChatGroupCreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreateGroup={handleCreateGroup}
      />
    ),
    onCreateThread: async () => {
      setCreateModalOpen(true);
    },
    setupDescription: t('Chat.groupSetupRequired', {
      defaultValue: 'Sign in to participate in group conversations.',
    }),
  }), [
    adapter,
    allGroups,
    canonicalMessages,
    createModalOpen,
    currentUserId,
    handleCreateGroup,
    handleSelectTarget,
    handleSendMessage,
    participants,
    selectedGroup,
    selectedGroupId,
    selectedGroupTitle,
    sendMutation.isPending,
    t,
    targets,
  ]);
}
