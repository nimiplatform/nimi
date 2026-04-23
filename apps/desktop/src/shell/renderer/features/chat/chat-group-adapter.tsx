import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createReadyConversationSetupState } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { ConversationCanonicalMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
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
import { detectGroupAgentTriggers } from './chat-group-agent-dispatcher';
import { executeGroupAgentTurn } from './chat-group-agent-execution';
import { createAISnapshot } from './conversation-capability';

/**
 * Wave 5: Module-level dedup set tracking messageIds that have already been
 * dispatched for agent trigger detection. Prevents re-triggering on React Query
 * refetch, realtime-driven cache invalidation, or any other data refresh.
 */
const dispatchedMessageIds = new Set<string>();

/** Exported for testing. */
export function clearDispatchedMessageIds(): void {
  dispatchedMessageIds.clear();
}

const GROUP_CHATS_QUERY_KEY = ['group-chats'] as const;

/**
 * Wave 5: Shared dispatch logic — detects triggers and fires execution for a single message.
 * Used by both send-mutation onSuccess (owner messages) and incoming-message detection
 * (cross-user triggering via realtime push).
 */
function dispatchGroupAgentTriggersForMessage(
  msg: GroupMessageViewDto,
  msgId: string,
  participants: readonly GroupParticipantDto[],
  allMessages: readonly GroupMessageViewDto[],
  currentUserId: string,
  groupChatId: string,
  qc: ReturnType<typeof useQueryClient>,
): void {
  // Wave 5: Dedup — skip if already dispatched for this messageId
  if (!msgId || dispatchedMessageIds.has(msgId)) {
    return;
  }
  dispatchedMessageIds.add(msgId);

  // Skip messages authored by the current user's agents (prevent self-loop)
  const authorAccountId = String(msg.author?.accountId || '');
  const authorType = String(msg.author?.type || '');
  const authorOwnerId = String(msg.author?.agentOwnerId || '');
  if (authorType === 'agent' && authorOwnerId === currentUserId) {
    logRendererEvent({
      area: 'group-agent-dispatch',
      message: 'skip: own_agent_message',
      details: { messageId: msgId, agentAccountId: authorAccountId, groupChatId },
    });
    return;
  }

  const triggers = detectGroupAgentTriggers({
    message: msg,
    participants,
    currentUserId,
    allMessages,
  });

  if (triggers.length === 0) return;

  const storeState = useAppStore.getState();
  const agentResolution = storeState.agentEffectiveCapabilityResolution;
  const runtimeFields = storeState.runtimeFields;
  const aiConfig = storeState.aiConfig;

  for (const trigger of triggers) {
    const agentBio = null; // Agent bio not available from participant DTO

    // Build execution snapshot from current resolution if available
    let textExecutionSnapshot = null;
    if (agentResolution?.ready && agentResolution.textProjection && aiConfig) {
      try {
        textExecutionSnapshot = createAISnapshot({
          config: aiConfig,
          capability: 'text.generate',
          projection: agentResolution.textProjection,
          agentResolution,
        });
      } catch {
        // Snapshot creation failed — agent will stay silent
      }
    }

    logRendererEvent({
      area: 'group-agent-dispatch',
      message: 'triggered',
      details: { triggerType: trigger.type, agentAccountId: trigger.agentAccountId, groupChatId, messageId: msgId },
    });

    // Fire and forget — failure = silence per D-LLM-026b
    void executeGroupAgentTurn({
      agentAccountId: trigger.agentAccountId,
      agentDisplayName: trigger.agentDisplayName,
      agentBio,
      groupChatId,
      trigger,
      recentTranscript: allMessages,
      agentResolution: agentResolution || { ready: false, textProjection: null, imageProjection: null, voiceProjection: null, voiceWorkflowProjections: {}, voiceWorkflowReadyByCapability: {}, imageReady: false, voiceReady: false, reason: 'projection_unavailable' },
      textExecutionSnapshot: textExecutionSnapshot!,
      runtimeConfigState: null,
      runtimeFields,
      reasoningPreference: 'off',
    }).then(() => {
      // Refresh messages to show agent response
      void qc.invalidateQueries({ queryKey: ['group-messages', groupChatId] });
      void qc.invalidateQueries({ queryKey: GROUP_CHATS_QUERY_KEY });
    }).catch(() => {
      // D-LLM-026b: silence on failure — already handled in executeGroupAgentTurn
    });
  }
}

function mergeGroupTranscriptWithMessage(
  transcript: readonly GroupMessageViewDto[],
  message: GroupMessageViewDto,
): GroupMessageViewDto[] {
  const messageId = String(message.id || '');
  if (!messageId) {
    return [...transcript];
  }
  const exists = transcript.some((item) => String(item.id || '') === messageId);
  const nextTranscript = exists ? [...transcript] : [...transcript, message];
  nextTranscript.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  return nextTranscript;
}

async function maybeDispatchGroupAgentTriggersForChat(input: {
  message: GroupMessageViewDto;
  participants: readonly GroupParticipantDto[];
  currentUserId: string;
  groupChatId: string;
  qc: ReturnType<typeof useQueryClient>;
  transcriptOverride?: readonly GroupMessageViewDto[];
  allowCurrentUserMessage?: boolean;
}): Promise<void> {
  const {
    message,
    participants,
    currentUserId,
    groupChatId,
    qc,
    transcriptOverride,
    allowCurrentUserMessage = false,
  } = input;
  const msgId = String(message.id || '');
  if (!msgId || dispatchedMessageIds.has(msgId)) {
    return;
  }

  const senderId = String(message.senderId || message.author?.accountId || '');
  const authorType = String(message.author?.type || '');
  const authorOwnerId = String(message.author?.agentOwnerId || '');
  if ((!allowCurrentUserMessage && senderId === currentUserId) || (authorType === 'agent' && authorOwnerId === currentUserId)) {
    dispatchedMessageIds.add(msgId);
    return;
  }

  const transcriptItems = transcriptOverride
    ? [...transcriptOverride]
    : ((await dataSync.loadGroupMessages(groupChatId)) as { items?: GroupMessageViewDto[] } | undefined)?.items || [];

  const mergedTranscript = mergeGroupTranscriptWithMessage(transcriptItems, message);
  dispatchGroupAgentTriggersForMessage(
    message,
    msgId,
    participants,
    mergedTranscript,
    currentUserId,
    groupChatId,
    qc,
  );
}

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

  // Ref for participants to avoid stale closures in dispatch
  const participantsRef = useRef<readonly GroupParticipantDto[]>([]);
  participantsRef.current = selectedGroup?.participants || [];

  const messagesRef = useRef<readonly GroupMessageViewDto[]>([]);
  messagesRef.current = (messagesQuery.data as { items?: GroupMessageViewDto[] } | undefined)?.items || [];

  // Wave 5: Incoming-message trigger detection — scans newly arrived messages
  // (e.g., from realtime-driven query invalidation) for @mentions of owned agents.
  // This enables cross-user triggering: when another user mentions your agent,
  // the realtime handler invalidates the group queries, React Query refetches,
  // and this effect detects the new message and dispatches execution.
  useEffect(() => {
    if (!currentUserId || !selectedGroupId) return;
    const items = messagesRef.current;
    if (items.length === 0) return;

    for (const msg of items) {
      const msgId = String(msg.id || '');
      if (!msgId || dispatchedMessageIds.has(msgId)) continue;

      // Only dispatch for messages by other participants (not self-sent — those
      // are handled by sendMutation.onSuccess, and not own-agent — those are responses)
      const senderId = String(msg.senderId || msg.author?.accountId || '');
      if (senderId === currentUserId) continue;

      dispatchGroupAgentTriggersForMessage(
        msg, msgId, participantsRef.current, items,
        currentUserId, selectedGroupId, queryClient,
      );
    }
  }, [messagesQuery.data, currentUserId, selectedGroupId, queryClient]);

  useEffect(() => {
    if (!currentUserId || authStatus !== 'authenticated') {
      return;
    }

    const backgroundGroups = allGroups.filter((group) => String(group.id || '') !== selectedGroupId);
    if (backgroundGroups.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const group of backgroundGroups) {
        if (cancelled) {
          return;
        }
        const groupChatId = String(group.id || '');
        const lastMessage = group.lastMessage;
        if (!groupChatId || !lastMessage) {
          continue;
        }
        try {
          await maybeDispatchGroupAgentTriggersForChat({
            message: lastMessage,
            participants: group.participants || [],
            currentUserId,
            groupChatId,
            qc: queryClient,
          });
        } catch (error) {
          logRendererEvent({
            level: 'warn',
            area: 'group-agent-dispatch',
            message: 'background_group_scan_failed',
            details: {
              groupChatId,
              error: error instanceof Error ? error.message : String(error || 'unknown error'),
            },
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allGroups, authStatus, currentUserId, queryClient, selectedGroupId]);

  const sendMutation = useMutation({
    mutationFn: async ({ chatId, content }: { chatId: string; content: string }) => {
      return dataSync.sendGroupMessage(chatId, content);
    },
    onSuccess: (sentMessage, variables) => {
      const sentChatId = String(variables.chatId || '');
      if (sentChatId) {
        void queryClient.invalidateQueries({ queryKey: ['group-messages', sentChatId] });
      }
      void queryClient.invalidateQueries({ queryKey: GROUP_CHATS_QUERY_KEY });

      // Dispatch agent execution for @mentions / reply-to-agent (D-LLM-026b group-safe path)
      if (sentMessage && currentUserId) {
        const msg = sentMessage as GroupMessageViewDto;
        if (selectedGroupId === sentChatId) {
          const msgId = String(msg.id || '');
          const nextTranscript = [...messagesRef.current, msg];
          dispatchGroupAgentTriggersForMessage(
            msg, msgId, participantsRef.current, nextTranscript,
            currentUserId, sentChatId, queryClient,
          );
        } else {
          void maybeDispatchGroupAgentTriggersForChat({
            message: msg,
            participants: groupById.get(sentChatId)?.participants || [],
            currentUserId,
            groupChatId: sentChatId,
            qc: queryClient,
            transcriptOverride: [msg],
            allowCurrentUserMessage: true,
          });
        }
      }
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
    if (
      result
      && currentUserId
      && typeof result === 'object'
      && 'id' in result
      && 'lastMessage' in result
      && result.lastMessage
    ) {
      void maybeDispatchGroupAgentTriggersForChat({
        message: result.lastMessage as GroupMessageViewDto,
        participants: ((result as { participants?: GroupParticipantDto[] }).participants) || [],
        currentUserId,
        groupChatId: String((result as { id: string }).id),
        qc: queryClient,
        transcriptOverride: [result.lastMessage as GroupMessageViewDto],
        allowCurrentUserMessage: true,
      });
    }
    if (result && typeof result === 'object' && 'id' in result) {
      setSelectedTargetForSource('group', String((result as { id: string }).id));
    }
  }, [currentUserId, queryClient, setSelectedTargetForSource]);

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
        agentParticipants={participants.filter((p) => p.type === 'agent')}
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
