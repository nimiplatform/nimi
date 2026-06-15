import { useCallback, useEffect, useMemo } from 'react';
import { createReadyConversationSetupState } from '@nimiplatform/kit/features/chat/headless';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { setGroupLocalAgentParticipationActive } from './chat-shared-active-ai-config-scope';
import { realmGroupChatData } from './data/realm-group-chat-data';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { ChatGroupParticipantPanel } from './chat-group-participant-panel';
import { ChatGroupComposer } from './chat-group-composer';
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `participant` is a LocalAgent the current user can invoke in this
 * group: an agent slot the user owns with a fully Realm-projected slot/agent/
 * local-agent identity. This is the canonical Group LocalAgent participation
 * criterion shared by mention resolution and NimiAIConfig scope binding.
 */
function isInvokableGroupLocalAgentParticipant(
  participant: GroupParticipantDto,
  userId: string,
): boolean {
  return (
    participant.type === 'agent'
    && normalizeText(participant.agentOwnerId) === userId
    && Boolean(normalizeText(participant.realmGroupAgentSlotId))
    && Boolean(normalizeText(participant.realmAgentId))
    && Boolean(normalizeText(participant.localAgentRef))
  );
}

/**
 * Whether the selected group has any active LocalAgent participation for the
 * current user. Drives whether Group reuses the `desktop.chat.agent` NimiAIConfig
 * scope (T3-2). When there is no LocalAgent participation, no built-in chat
 * scope is bound for Group.
 */
export function hasInvokableGroupLocalAgentParticipation(
  participants: readonly GroupParticipantDto[],
  currentUserId: string | null,
): boolean {
  const userId = normalizeText(currentUserId);
  if (!userId) {
    return false;
  }
  return participants.some((participant) =>
    isInvokableGroupLocalAgentParticipant(participant, userId),
  );
}

export function resolveInvokableGroupAgentMention(
  content: string,
  participants: readonly GroupParticipantDto[],
  currentUserId: string | null,
): GroupParticipantDto | null {
  const userId = normalizeText(currentUserId);
  if (!userId) {
    return null;
  }
  const candidates = participants
    .filter((participant) =>
      isInvokableGroupLocalAgentParticipant(participant, userId),
    )
    .sort((a, b) =>
      normalizeText(b.displayName || b.handle).length
      - normalizeText(a.displayName || a.handle).length,
    );

  for (const participant of candidates) {
    const mentionName = normalizeText(participant.displayName || participant.handle);
    if (!mentionName) {
      continue;
    }
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(mentionName)}(?=\\s|$|[.,!?])`, 'i');
    if (pattern.test(content)) {
      return participant;
    }
  }
  return null;
}

export function useGroupConversationModeHost(
  input: UseGroupConversationModeHostInput,
): DesktopConversationModeHost {
  const { authStatus, currentUserId } = input;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setLastSelectedThreadForMode = useAppStore((state) => state.setLastSelectedThreadForMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.group ?? null);
  const selectedGroupId = storeSelectedTargetId;

  const groupChatsQuery = useQuery({
    queryKey: [...GROUP_CHATS_QUERY_KEY, authStatus],
    queryFn: async () => realmGroupChatData.loadGroupChats(),
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
      const result = await realmGroupChatData.loadGroupMessages(selectedGroupId);
      void realmGroupChatData.markGroupRead(selectedGroupId);
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
      return realmGroupChatData.sendGroupMessage(chatId, content);
    },
    onSettled: (_sentMessage, _error, variables) => {
      const sentChatId = String(variables.chatId || '');
      if (sentChatId) {
        void queryClient.invalidateQueries({ queryKey: ['group-messages', sentChatId] });
      }
      void queryClient.invalidateQueries({ queryKey: GROUP_CHATS_QUERY_KEY });
    },
  });

  const candidateCommitMutation = useMutation({
    mutationFn: async ({
      chatId,
      participant,
      triggerMessage,
    }: {
      chatId: string;
      participant: GroupParticipantDto;
      triggerMessage: GroupMessageViewDto;
    }) => realmGroupChatData.commitRealmGroupMessageCandidate(chatId, participant, triggerMessage),
    onSettled: (_result, _error, variables) => {
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

  const participants: readonly GroupParticipantDto[] = selectedGroup?.participants || [];

  // T3-2: Group LocalAgent participation reuses the canonical
  // `desktop.chat.agent` built-in NimiAIConfig scope — the SAME scope as Agent
  // Chat. When the selected group has invokable LocalAgent participation, bind
  // that agent scope; otherwise no built-in chat scope is bound. Group thread
  // state stays Realm-owned — only the LocalAgent-participation NimiAIConfig is
  // scoped, and it never mints a group-specific scope.
  const groupHasLocalAgentParticipation = useMemo(
    () => hasInvokableGroupLocalAgentParticipation(participants, currentUserId),
    [participants, currentUserId],
  );
  useEffect(() => {
    setGroupLocalAgentParticipationActive(groupHasLocalAgentParticipation);
  }, [groupHasLocalAgentParticipation]);
  useEffect(() => () => {
    // Leaving the Group surface clears participation so a later mode does not
    // inherit a stale agent-scope binding from Group.
    setGroupLocalAgentParticipationActive(false);
  }, []);

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
    composerAdapter: null,
  }), [setupState, threads]);

  const handleSelectTarget = useCallback((targetId: string | null) => {
    setSelectedTargetForSource('group', targetId);
  }, [setSelectedTargetForSource]);

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedGroupId || !content.trim()) return;
    const trimmed = content.trim();
    const mentionedAgent = resolveInvokableGroupAgentMention(
      trimmed,
      participants,
      currentUserId,
    );
    const sentMessage = await sendMutation.mutateAsync({ chatId: selectedGroupId, content: trimmed });
    if (mentionedAgent) {
      await candidateCommitMutation.mutateAsync({
        chatId: selectedGroupId,
        participant: mentionedAgent,
        triggerMessage: sentMessage,
      });
    }
  }, [candidateCommitMutation, currentUserId, participants, selectedGroupId, sendMutation]);

  const selectedGroupTitle = selectedGroup
    ? getGroupChatTitle(selectedGroup)
    : t('Chat.group', { defaultValue: 'Group' });

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
        isSending={sendMutation.isPending || candidateCommitMutation.isPending}
        agentParticipants={participants}
      />
    ) : null,
    setupDescription: t('Chat.groupSetupRequired', {
      defaultValue: 'Sign in to participate in group conversations.',
    }),
  }), [
    adapter,
    allGroups,
    canonicalMessages,
    currentUserId,
    handleSelectTarget,
    handleSendMessage,
    participants,
    queryClient,
    selectedGroup,
    selectedGroupId,
    selectedGroupTitle,
    candidateCommitMutation.isPending,
    sendMutation.isPending,
    setSelectedTargetForSource,
    t,
    targets,
  ]);
}
