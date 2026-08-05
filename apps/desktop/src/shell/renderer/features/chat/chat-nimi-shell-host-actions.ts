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
  bundleQueryKey,
  createEmptyBundle,
  THREADS_QUERY_KEY,
  upsertBundleDraft,
} from './chat-nimi-shell-core';

type UseAiConversationHostActionsInput = {
  activeThreadId: string | null;
  currentDraftTextRef: { current: string };
  ephemeralThread: ChatAiThreadRecord | null;
  executeTextCapability: (text: string) => Promise<DesktopNimiTextCapabilityResult>;
  now: () => number;
  queryClient: QueryClient;
  reportHostError: (error: unknown) => void;
  selectedThreadRecord: ChatAiThreadSummary | null;
  setBundleCache: (
    threadId: string,
    updater: (current: ChatAiThreadBundle | null | undefined) => ChatAiThreadBundle | null | undefined,
  ) => void;
  setEphemeralThread: (thread: ChatAiThreadRecord | null) => void;
  setSubmittingThreadId: (threadId: string | null) => void;
  submittingThreadId: string | null;
  syncSelectionToThread: (threadId: string | null) => void;
  threads: readonly ChatAiThreadSummary[];
};

export async function ensureChatAiThreadRecordPersisted(input: {
  thread: ChatAiThreadRecord;
  verifyExisting: boolean;
}): Promise<{
  thread: ChatAiThreadRecord;
  recoveredMissingThread: boolean;
}> {
  if (input.verifyExisting) {
    const existing = await chatAiStoreClient.getThreadBundle(input.thread.id);
    if (existing?.thread) {
      return {
        thread: existing.thread,
        recoveredMissingThread: false,
      };
    }
  }

  const persisted = await chatAiStoreClient.createThread({
    id: input.thread.id,
    title: input.thread.title,
    createdAtMs: input.thread.createdAtMs,
    updatedAtMs: input.thread.updatedAtMs,
    lastMessageAtMs: input.thread.lastMessageAtMs,
  });
  return {
    thread: persisted,
    recoveredMissingThread: input.verifyExisting,
  };
}

export function useAiConversationHostActions(
  input: UseAiConversationHostActionsInput,
): {
  handleCreateThread: () => Promise<void>;
  handleSelectThread: (threadId: string) => void;
  handleSubmit: (text: string) => Promise<void>;
} {
  const syncAiThreadSelectionState = useCallback((threadId: string | null) => {
    input.syncSelectionToThread(threadId);
  }, [input]);

  const persistDraftForThread = useCallback(async (threadId: string | null) => {
    const normalizedThreadId = threadId?.trim() || '';
    if (!normalizedThreadId) return;
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
    input.currentDraftTextRef.current = '';
    syncAiThreadSelectionState(thread.id);
  }, [input, syncAiThreadSelectionState]);

  const handleSelectThread = useCallback((threadId: string) => {
    if (!threadId || threadId === input.activeThreadId || input.submittingThreadId) return;
    if (!input.threads.some((candidate) => candidate.id === threadId)) return;
    if (input.ephemeralThread && input.activeThreadId === input.ephemeralThread.id) {
      input.queryClient.removeQueries({ queryKey: bundleQueryKey(input.ephemeralThread.id) });
      input.setEphemeralThread(null);
    }
    void (async () => {
      await persistDraftForThread(input.activeThreadId);
      input.currentDraftTextRef.current = '';
      syncAiThreadSelectionState(threadId);
    })().catch(input.reportHostError);
  }, [input, persistDraftForThread, syncAiThreadSelectionState]);

  const handleSubmit = useCallback(async (value: string) => {
    const text = value.trim();
    if (!text || input.submittingThreadId) return;
    const createdAtMs = input.now();
    const baseThread: ChatAiThreadRecord = input.ephemeralThread
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
    input.setSubmittingThreadId(baseThread.id);
    try {
      // Runtime/Kit owns execution admission and implementation selection.
      const result = await input.executeTextCapability(text);
      const persisted = await ensureChatAiThreadRecordPersisted({
        thread: baseThread,
        verifyExisting: Boolean(input.selectedThreadRecord && !input.ephemeralThread),
      });
      const userMessage = await chatAiStoreClient.createMessage({
        id: createNimiClientId('ai-message-user'),
        threadId: persisted.thread.id,
        role: 'user',
        status: 'complete',
        contentText: text,
        content: createPlainTextMessageContent(text),
        error: null,
        traceId: null,
        parentMessageId: null,
        createdAtMs,
        updatedAtMs: createdAtMs,
      });
      const assistantMessage = await chatAiStoreClient.createMessage({
        id: createNimiClientId('ai-message-assistant'),
        threadId: persisted.thread.id,
        role: 'assistant',
        status: 'complete',
        contentText: result.text,
        content: createAssistantMessageContent(result.text),
        error: null,
        traceId: result.traceId,
        parentMessageId: userMessage.id,
        createdAtMs: createdAtMs + 1,
        updatedAtMs: createdAtMs + 1,
      });
      const updatedThread = await chatAiStoreClient.updateThreadMetadata({
        id: persisted.thread.id,
        title: resolveThreadTitleAfterFirstSend(persisted.thread.title, text),
        updatedAtMs: assistantMessage.updatedAtMs,
        lastMessageAtMs: assistantMessage.updatedAtMs,
      });
      await chatAiStoreClient.deleteDraft(updatedThread.id);
      input.queryClient.setQueryData<ChatAiThreadBundle>(bundleQueryKey(updatedThread.id), (current) => ({
        thread: updatedThread,
        messages: [...(current?.messages ?? []), userMessage, assistantMessage],
        draft: null,
      }));
      input.setEphemeralThread(null);
      input.currentDraftTextRef.current = '';
      syncAiThreadSelectionState(updatedThread.id);
      await input.queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
    } catch (error) {
      input.reportHostError(error);
      throw error;
    } finally {
      input.setSubmittingThreadId(null);
    }
  }, [input, syncAiThreadSelectionState]);

  return {
    handleCreateThread,
    handleSelectThread,
    handleSubmit,
  };
}
