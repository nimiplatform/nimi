import { useCallback, useMemo } from 'react';
import { useHomeDestination, useHomeEntryKey, useHomeNavigation } from './app-store.js';
import type { NimiConversationSelection } from '../../features/chat/chat-shell-types.js';
import type { HomeChatPosition } from './home-navigation.js';

/** App-owned conversation references; Runtime remains the Conversation/data owner. */
export function useHomeChatPosition() {
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const entryKey = useHomeEntryKey();
  const chat = destination.chat;
  const mode = chat?.mode ?? 'ai';
  const open = useCallback((position: HomeChatPosition) => void navigation.push({ id: position.mode === 'human' ? 'friends' : 'chat', chat: position }), [navigation]);
  const refine = useCallback((position: HomeChatPosition) => {
    const current = navigation.getSnapshot().current;
    if (current.key !== entryKey || !['chat', 'friends'].includes(current.destination.id)) return;
    const explicit = current.destination.chat;
    if (explicit && (position.mode !== explicit.mode
      || explicit.targetId && !position.targetId || explicit.threadId && !position.threadId)) return;
    void navigation.replace({ id: position.mode === 'human' ? 'friends' : 'chat', chat: position });
  }, [entryKey, navigation]);
  const openMode = useCallback((mode: HomeChatPosition['mode']) => open({ mode }), [open]);
  const openTarget = useCallback((mode: HomeChatPosition['mode'], targetId: string | null) => open({ mode, targetId: targetId ?? undefined }), [open]);
  const nimiSelection = useMemo<NimiConversationSelection>(() => ({ threadId: mode === 'ai' ? chat?.threadId ?? null : null }), [mode, chat?.threadId]);
  const selectNimiThread = useCallback((selection: NimiConversationSelection) => {
    const current = navigation.getSnapshot().current;
    if (current.key !== entryKey || !['chat', 'friends'].includes(current.destination.id) || current.destination.chat?.mode !== 'ai') return;
    const position = { mode: 'ai' as const, targetId: 'ai:assistant', threadId: selection.threadId ?? undefined };
    if (!selection.threadId && current.destination.chat?.threadId) return;
    if (!current.destination.chat?.threadId) refine(position); else if (selection.threadId) open(position);
  }, [entryKey, navigation, open, refine]);
  const resolveHumanThread = useCallback((threadId: string | null) => {
    const current = navigation.getSnapshot().current;
    if (current.key !== entryKey || current.destination.chat?.mode !== 'human') return;
    if (!threadId || current.destination.chat.threadId) return;
    refine({ ...current.destination.chat, threadId: threadId ?? undefined });
  }, [entryKey, navigation, refine]);
  return { mode, targetId: chat?.targetId ?? (mode === 'ai' ? 'ai:assistant' : null), nimiSelection,
    humanThreadId: mode === 'human' ? chat?.threadId ?? null : null, open, openMode, openTarget, refine, selectNimiThread, resolveHumanThread };
}
