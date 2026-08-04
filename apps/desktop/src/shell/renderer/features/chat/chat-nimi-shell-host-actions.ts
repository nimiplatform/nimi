import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  ChatAiThreadBundle,
  ChatAiThreadRecord,
  ChatAiThreadSummary,
} from '../../bridge/runtime-bridge/types';
import { chatAiStoreClient } from '../../bridge/runtime-bridge/chat-ai-store';
import { createNimiClientId } from '@nimiplatform/sdk';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import { AI_NEW_CONVERSATION_TITLE } from './chat-nimi-thread-model';
import {
  bundleQueryKey,
  createEmptyBundle,
  upsertBundleDraft,
} from './chat-nimi-shell-core';

type UseAiConversationHostActionsInput = {
  activeThreadId: string | null;
  currentDraftTextRef: { current: string };
  ephemeralThread: ChatAiThreadRecord | null;
  now: () => number;
  queryClient: QueryClient;
  reportHostError: (error: unknown) => void;
  selectedThreadRecord: ChatAiThreadSummary | null;
  setBundleCache: (
    threadId: string,
    updater: (current: ChatAiThreadBundle | null | undefined) => ChatAiThreadBundle | null | undefined,
  ) => void;
  setEphemeralThread: (thread: ChatAiThreadRecord | null) => void;
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

function appAIConfigExecutionPending(): never {
  throw createNimiError({
    message: 'Nimi Chat execution is unavailable until Runtime App AIConfig composition is active.',
    reasonCode: ReasonCode.AI_ROUTE_UNSUPPORTED,
    actionHint: 'wait_for_app_ai_config_execution_support',
    source: 'runtime',
  });
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

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim()) return;
    return appAIConfigExecutionPending();
  }, []);

  return {
    handleCreateThread,
    handleSelectThread,
    handleSubmit,
  };
}
