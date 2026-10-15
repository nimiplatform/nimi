import { useCallback, useMemo } from 'react';
import { useHomeDestination, useHomeEntryKey, useHomeNavigation } from './app-store.js';
import type { AgentConversationSelection, NimiConversationSelection } from '../../features/chat/chat-shell-types.js';
import type { HomeChatPosition } from './home-navigation.js';

/** App-owned conversation references; Runtime remains the Conversation/data owner. */
export function useHomeChatPosition() {
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const entryKey = useHomeEntryKey();
  const chat = destination.chat;
  const mode = chat?.mode ?? 'ai';
  const open = useCallback((position: HomeChatPosition) => void navigation.push({ id: 'chat', chat: position }), [navigation]);
  const refine = useCallback((position: HomeChatPosition) => {
    const current = navigation.getSnapshot().current;
    if (current.key !== entryKey || current.destination.id !== 'chat') return;
    const explicit = current.destination.chat;
    if (explicit?.managerAnchorId) return; // Only the correlated manager resolver may fulfill this request.
    if (explicit && (position.mode !== explicit.mode
      || explicit.targetId && !position.targetId || explicit.threadId && !position.threadId
      || explicit.conversationAnchorId && !position.conversationAnchorId)) return;
    void navigation.replace({ id: 'chat', chat: position });
  }, [entryKey, navigation]);
  const openMode = useCallback((mode: HomeChatPosition['mode']) => open({ mode }), [open]);
  const openTarget = useCallback((mode: HomeChatPosition['mode'], targetId: string | null) => open({ mode, targetId: targetId ?? undefined }), [open]);
  const nimiSelection = useMemo<NimiConversationSelection>(() => ({ threadId: mode === 'ai' ? chat?.threadId ?? null : null }), [mode, chat?.threadId]);
  const agentSelection = useMemo<AgentConversationSelection>(() => ({
    agentHandle: mode === 'agent' ? chat?.agentHandle ?? null : null,
    conversationAnchorId: mode === 'agent' ? chat?.conversationAnchorId ?? null : null,
    targetId: mode === 'agent' ? chat?.targetId ?? chat?.agentHandle ?? null : null,
  }), [mode, chat?.agentHandle, chat?.conversationAnchorId, chat?.targetId]);
  const selectNimiThread = useCallback((selection: NimiConversationSelection) => {
    const current = navigation.getSnapshot().current;
    if (current.key !== entryKey || current.destination.id !== 'chat' || current.destination.chat?.mode !== 'ai') return;
    const position = { mode: 'ai' as const, targetId: 'ai:assistant', threadId: selection.threadId ?? undefined };
    if (!selection.threadId && current.destination.chat?.threadId) return;
    if (!current.destination.chat?.threadId) refine(position); else if (selection.threadId) open(position);
  }, [entryKey, navigation, open, refine]);
  const selectAgentConversation = useCallback((selection: AgentConversationSelection) => {
    const entry = navigation.getSnapshot().current;
    if (entry.key !== entryKey || entry.destination.id !== 'chat' || entry.destination.chat?.mode !== 'agent') return;
    const position = { mode: 'agent' as const, targetId: selection.targetId ?? undefined, agentHandle: selection.agentHandle ?? undefined, conversationAnchorId: selection.conversationAnchorId ?? undefined };
    const current = navigation.getSnapshot().current.destination.chat;
    if (current?.conversationAnchorId && (!selection.conversationAnchorId || !selection.agentHandle)) return;
    // Filling/rotating a proven handle is reconciliation of this reference, not another visit.
    if (current?.mode === 'agent' && (!current.conversationAnchorId || current.conversationAnchorId === selection.conversationAnchorId)) refine(position);
    else open(position);
  }, [entryKey, navigation, open, refine]);
  const resolveHumanThread = useCallback((threadId: string | null) => {
    const current = navigation.getSnapshot().current;
    if (current.key !== entryKey || current.destination.chat?.mode !== 'human') return;
    if (!threadId || current.destination.chat.threadId) return;
    refine({ ...current.destination.chat, threadId: threadId ?? undefined });
  }, [entryKey, navigation, refine]);
  const resolveAgentCenterRequest = useCallback((selection: AgentConversationSelection | null) => {
    const entry = navigation.getSnapshot().current;
    if (entry.key !== entryKey || entry.destination.chat?.mode !== 'agent' || !entry.destination.chat.managerAnchorId) return;
    if (selection && selection.conversationAnchorId !== entry.destination.chat.managerAnchorId) return;
    void navigation.replace({ id: 'chat', chat: selection
      ? { mode: 'agent', agentHandle: selection.agentHandle ?? undefined, conversationAnchorId: selection.conversationAnchorId ?? undefined, targetId: selection.agentHandle ?? undefined }
      : { mode: 'agent' } });
  }, [entryKey, navigation]);
  return { mode, targetId: chat?.targetId ?? (mode === 'ai' ? 'ai:assistant' : null), nimiSelection, agentSelection,
    managerAnchorId: chat?.managerAnchorId ?? null, resolveAgentCenterRequest,
    humanThreadId: mode === 'human' ? chat?.threadId ?? null : null, open, openMode, openTarget, refine, selectNimiThread, selectAgentConversation, resolveHumanThread };
}
