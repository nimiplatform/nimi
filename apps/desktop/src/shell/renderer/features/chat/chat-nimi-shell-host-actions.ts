import { nimiComposerDraftRef, type ComposerMemory } from './chat-nimi-composer-draft.js';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  ChatAiThreadBundle,
  ChatAiThreadRecord,
  ChatAiThreadSummary,
} from '../../bridge/runtime-bridge/types';
import { chatAiStoreClient } from '../../bridge/runtime-bridge/chat-ai-store';
import { createNimiClientId } from '@nimiplatform/sdk';
import {
  AI_NEW_CONVERSATION_TITLE,
  createAssistantMessageContent,
  createPlainTextMessageContent,
  resolveThreadTitleAfterFirstSend,
} from './chat-nimi-thread-model';
import type { DesktopNimiTextCapabilityResult } from './chat-nimi-shell-runtime-adapter';
import {
  appendOptimisticUserMessage,
  bundleQueryKey,
  createEmptyBundle,
  THREADS_QUERY_KEY,
  upsertThreadSummary,
  upsertBundleDraft,
} from './chat-nimi-shell-core';

type UseAiConversationHostActionsInput = {
  activeThreadId: string | null;
  currentDraftTextRef: { current: string };
  ephemeralThread: ChatAiThreadRecord | null;
  executeTextCapability: (text: string, history: ChatAiThreadBundle['messages'], signal: AbortSignal) => Promise<DesktopNimiTextCapabilityResult>;
  navigation: HomeNavigation;
  composerMemory: ComposerMemory;
  reportTruncation: () => void;
  reportExpiredSave: () => void;
  clearHostError: () => void;
  now: () => number;
  queryClient: QueryClient;
  reportHostError: (error: unknown) => void;
  selectedThreadRecord: ChatAiThreadSummary | null;
  setBundleCache: (
    threadId: string,
    updater: (current: ChatAiThreadBundle | null | undefined) => ChatAiThreadBundle | null | undefined,
  ) => void;
  setEphemeralThread: (thread: ChatAiThreadRecord | null) => void;
  syncSelectionToThread: (threadId: string | null) => void;
  threads: readonly ChatAiThreadSummary[];
};

export function useAiConversationHostActions(
  input: UseAiConversationHostActionsInput,
): {
  handleCreateThread: () => Promise<void>;
  handleSelectThread: (threadId: string) => Promise<void>;
  handleSubmit: (text: string) => Promise<void>;
} {
  const syncAiThreadSelectionState = useCallback((threadId: string | null) => {
    input.syncSelectionToThread(threadId);
  }, [input]);

  const persistDraftForThread = useCallback(async (threadId: string | null) => {
    const normalizedThreadId = threadId?.trim() || '';
    if (!normalizedThreadId) return;
    // Unsent threads live in the scoped composer memory and query cache only.
    // Keep that draft when leaving; the native store has no thread to update.
    if (normalizedThreadId === input.ephemeralThread?.id) return;
    const nextText = input.currentDraftTextRef.current;
    if (nextText.trim()) {
      const draft = await chatAiStoreClient.putDraft({
        threadId: normalizedThreadId,
        text: nextText,
        attachments: [],
        updatedAtMs: input.now(),
      });
      input.setBundleCache(
        normalizedThreadId,
        (current) => upsertBundleDraft(current, draft) || current,
      );
      return;
    }
    await chatAiStoreClient.deleteDraft(normalizedThreadId);
    input.setBundleCache(
      normalizedThreadId,
      (current) => upsertBundleDraft(current, null) || current,
    );
  }, [input]);

  const handleCreateThread = useCallback(async () => {
    if (input.composerMemory.getSnapshot().pending) return;
    if (input.ephemeralThread) {
      input.queryClient.removeQueries({ queryKey: bundleQueryKey(input.ephemeralThread.id) });
    }
    const timestampMs = input.now();
    const thread: ChatAiThreadRecord = {
      id: createNimiClientId('ai-thread'),
      title: AI_NEW_CONVERSATION_TITLE,
      createdAtMs: timestampMs,
      updatedAtMs: timestampMs,
      lastMessageAtMs: null,
    };
    input.setEphemeralThread(thread);
    input.queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyBundle(thread));
    syncAiThreadSelectionState(thread.id);
  }, [input, syncAiThreadSelectionState]);

  const handleSelectThread = useCallback(async (threadId: string) => {
    if (!threadId || threadId === input.activeThreadId || input.composerMemory.getSnapshot().pending) return;
    if (!input.threads.some((candidate) => candidate.id === threadId)) return;
    try {
      await persistDraftForThread(input.activeThreadId);
      syncAiThreadSelectionState(threadId);
    } catch (error) {
      input.reportHostError(error);
    }
  }, [input, persistDraftForThread, syncAiThreadSelectionState]);

  // @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
  const handleSubmit = useCallback(async (value: string) => {
    const text = value.trim();
    if (!text || input.composerMemory.getSnapshot().pending) return;
    input.clearHostError();
    const createdAtMs = input.now();
    // A side flip retains unsent drafts, but only the selected thread owns this send.
    const activeEphemeralThread = input.ephemeralThread?.id === input.activeThreadId
      ? input.ephemeralThread : null;
    const baseThread: ChatAiThreadRecord = activeEphemeralThread
      ?? (input.selectedThreadRecord && input.activeThreadId
        ? {
          ...input.selectedThreadRecord,
          id: input.activeThreadId,
          createdAtMs,
        }
        : {
          id: createNimiClientId('ai-thread'),
          title: AI_NEW_CONVERSATION_TITLE,
          createdAtMs,
          updatedAtMs: createdAtMs,
          lastMessageAtMs: null,
        });
    const isFreshThread = !activeEphemeralThread
      && !(input.selectedThreadRecord && input.activeThreadId);
    const { composerMemory, navigation, queryClient } = input;
    const scope = new AbortController();
    const isCurrent = () => navigation.getSnapshot().generation === composerMemory.generation;
    let finished = false;
    const clearPending = () => {
      finished = true;
      unsubscribe();
      composerMemory.setPending(null);
    };
    const unsubscribe = navigation.subscribe(() => {
      if (!isCurrent()) {
        scope.abort();
        clearPending();
      }
    });
    const userMessageId = createNimiClientId('ai-message-user');
    const replyId = createNimiClientId('ai-message-assistant');
    const draft = nimiComposerDraftRef(navigation, baseThread.id, '');
    const user = {
      id: userMessageId, threadId: baseThread.id, role: 'user' as const, status: 'complete' as const,
      contentText: text, content: createPlainTextMessageContent(text), error: null, traceId: null,
      parentMessageId: null, createdAtMs, updatedAtMs: createdAtMs,
    };
    composerMemory.setPending({ threadId: baseThread.id, phase: 'generating' });
    void queryClient.cancelQueries({ queryKey: bundleQueryKey(baseThread.id), exact: true });
    if (isFreshThread) input.setEphemeralThread(baseThread);
    input.setBundleCache(baseThread.id, current => appendOptimisticUserMessage(current, baseThread, { ...user, status: 'pending' }));
    if (isFreshThread) syncAiThreadSelectionState(baseThread.id);
    input.currentDraftTextRef.current = '';
    draft.current = '';

    let result: DesktopNimiTextCapabilityResult;
    let scopeId: string;
    let confirmed: ChatAiThreadBundle | null = null;
    try {
      scopeId = await chatAiStoreClient.beginTurn();
      scope.signal.throwIfAborted();
      if (!isFreshThread && !activeEphemeralThread) {
        confirmed = await chatAiStoreClient.getThreadBundle(baseThread.id);
        if (confirmed?.thread.id !== baseThread.id) throw new Error('chat-ai-thread-unavailable');
      }
      scope.signal.throwIfAborted();
      result = await input.executeTextCapability(text, confirmed?.messages ?? [], scope.signal);
    } catch (error) {
      if (isCurrent()) {
        if (!draft.current) draft.current = text;
        input.setBundleCache(baseThread.id, current => current && {
          ...current,
          messages: current.messages.filter(message => message.id !== user.id),
          draft: { threadId: baseThread.id, text: draft.current, attachments: [], updatedAtMs: input.now() },
        });
        input.reportHostError(error);
      }
      clearPending();
      return;
    }

    const commit = {
      scopeId, user, consumedDraft: confirmed?.draft ?? null,
      thread: { ...(confirmed?.thread ?? baseThread), title: resolveThreadTitleAfterFirstSend(confirmed?.thread.title ?? baseThread.title, text) },
      assistant: {
        ...user, id: replyId, role: 'assistant' as const, contentText: result.text,
        content: createAssistantMessageContent(result.text), traceId: result.traceId,
        parentMessageId: user.id, createdAtMs: createdAtMs + 1, updatedAtMs: createdAtMs + 1,
      },
    };
    const save = async () => {
      if (finished || composerMemory.getSnapshot().pending?.phase === 'saving') return;
      if (!isCurrent()) { clearPending(); return; }
      composerMemory.setPending({ threadId: baseThread.id, phase: 'saving' });
      let saved: ChatAiThreadBundle;
      try {
        saved = await chatAiStoreClient.commitTurn(commit);
      } catch (error) {
        if (!isCurrent()) { clearPending(); return; }
        if (error instanceof Error && error.message.includes('chat-ai-turn-scope-ended')) {
          clearPending();
          input.setBundleCache(baseThread.id, current => current && {
            ...current, messages: current.messages.filter(message => message.id !== user.id),
          });
          input.reportExpiredSave();
          void queryClient.invalidateQueries({ queryKey: bundleQueryKey(baseThread.id) });
          return;
        }
        // The same commit checks both message IDs before making any changes.
        // A retry can confirm a lost reply, and never executes the model again.
        composerMemory.setPending({ threadId: baseThread.id, phase: 'unconfirmed', retrySave: () => { void save(); } });
        return;
      }
      if (isCurrent()) {
        queryClient.setQueryData(bundleQueryKey(baseThread.id), saved);
        queryClient.setQueryData<ChatAiThreadSummary[]>(THREADS_QUERY_KEY, current => upsertThreadSummary(current ?? [], saved.thread));
        if (composerMemory.getSnapshot().ephemeralThread?.id === baseThread.id) input.setEphemeralThread(null);
        if (result.finishReason === 'length') input.reportTruncation();
      }
      clearPending();
    };
    await save();
  }, [input, syncAiThreadSelectionState]);

  return {
    handleCreateThread,
    handleSelectThread,
    handleSubmit,
  };
}
