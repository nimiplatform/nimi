import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  matchConversationTurnEvent,
  type ConversationTurnError,
  type ConversationTurnEvent,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  type ChatAiMessageRecord,
  type ChatAiThreadBundle,
  type ChatAiThreadRecord,
  type ChatAiThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAiStoreClient } from '@renderer/bridge/runtime-bridge/chat-ai-store';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { toChatAiRuntimeError } from './chat-ai-runtime';
import {
  AI_NEW_CONVERSATION_TITLE,
  createAssistantMessageContent,
  createPlainTextMessageContent,
  resolveThreadTitleAfterFirstSend,
} from './chat-ai-thread-model';
import type { AIConfig } from './conversation-capability';
import { resolveAIConfigSchedulingTargetForCapability } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { probeExecutionSchedulingGuard } from './chat-execution-scheduling-guard';
import {
  feedStreamEvent,
  getStreamState,
  startStream,
  STREAM_TEXT_TOTAL_TIMEOUT_MS,
} from '../turns/stream-controller';
import {
  bundleQueryKey,
  createEmptyBundle,
  normalizeReasoningText,
  replaceMessage,
  stripBeatActionEnvelopeIfPresent,
  toAbortError,
  toConversationHistoryMessages,
  toStructuredProviderError,
  upsertBundleDraft,
  upsertThreadSummary,
} from './chat-ai-shell-core';
import { ensureAiConversationSubmitRouteReady } from './conversation-submit-readiness';

type AiRunTurn = (input: {
  threadId: string;
  turnId: string;
  userMessage: {
    id: string;
    text: string;
    attachments: unknown[];
  };
  history: ReturnType<typeof toConversationHistoryMessages>;
  signal: AbortSignal;
}) => AsyncIterable<ConversationTurnEvent>;

type UseAiConversationHostActionsInput = {
  activeThreadId: string | null;
  aiConfig: AIConfig;
  bundleMessages: readonly ChatAiMessageRecord[] | undefined;
  currentDraftTextRef: { current: string };
  ephemeralThread: ChatAiThreadRecord | null;
  queryClient: QueryClient;
  reportHostError: (error: unknown) => void;
  runAiTurn: AiRunTurn;
  selectedThreadRecord: ChatAiThreadSummary | null;
  setBundleCache: (
    threadId: string,
    updater: (current: ChatAiThreadBundle | null | undefined) => ChatAiThreadBundle | null | undefined,
  ) => void;
  setEphemeralThread: (thread: ChatAiThreadRecord | null) => void;
  setSubmittingThreadId: (threadId: string | null) => void;
  setThreadsCache: (updater: (current: ChatAiThreadSummary[]) => ChatAiThreadSummary[]) => void;
  submittingThreadId: string | null;
  syncSelectionToThread: (threadId: string | null) => void;
  t: TFunction;
  threads: readonly ChatAiThreadSummary[];
};

export async function assertAiSubmitSchedulingAllowed(input: {
  aiConfig: AIConfig;
  t: TFunction;
}): Promise<void> {
  const target = resolveAIConfigSchedulingTargetForCapability(input.aiConfig, 'text.generate');
  const schedulingGuard = await probeExecutionSchedulingGuard({
    scopeRef: input.aiConfig.scopeRef,
    target,
    t: input.t,
  });
  if (schedulingGuard.disabled) {
    throw new Error(schedulingGuard.disabledReason || input.t('Chat.schedulingDeniedDetail', {
      defaultValue: 'Cannot execute: {{detail}}',
      detail: '',
    }));
  }
}

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
    archivedAtMs: input.thread.archivedAtMs,
  });
  return {
    thread: persisted,
    recoveredMissingThread: input.verifyExisting,
  };
}

export function useAiConversationHostActions(
  input: UseAiConversationHostActionsInput,
): {
  handleArchiveThread: (threadId: string) => Promise<void>;
  handleCreateThread: () => Promise<void>;
  handleRenameThread: (threadId: string, title: string) => void;
  handleSelectThread: (threadId: string) => void;
  handleSubmit: (text: string) => Promise<void>;
} {
  const syncAiThreadSelectionState = useCallback((
    threadId: string | null,
  ) => {
    input.syncSelectionToThread(threadId);
  }, [input]);

  const persistDraftForThread = useCallback(async (threadId: string | null) => {
    const normalizedThreadId = threadId?.trim() || '';
    if (!normalizedThreadId) {
      return;
    }
    const nextText = input.currentDraftTextRef.current;
    if (nextText.trim()) {
      const draft = await chatAiStoreClient.putDraft({
        threadId: normalizedThreadId,
        text: nextText,
        attachments: [],
        updatedAtMs: Date.now(),
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
    // Discard previous ephemeral thread if it exists (never persisted)
    if (input.ephemeralThread) {
      input.queryClient.removeQueries({ queryKey: bundleQueryKey(input.ephemeralThread.id) });
    }
    const timestampMs = Date.now();
    const thread: ChatAiThreadRecord = {
      id: randomIdV11('ai-thread'),
      title: AI_NEW_CONVERSATION_TITLE,
      createdAtMs: timestampMs,
      updatedAtMs: timestampMs,
      lastMessageAtMs: null,
      archivedAtMs: null,
    };
    // In-memory only — persisted to DB on first message send
    input.setEphemeralThread(thread);
    input.queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyBundle(thread));
    input.currentDraftTextRef.current = '';
    syncAiThreadSelectionState(thread.id);
  }, [input, syncAiThreadSelectionState]);

  const handleArchiveThread = useCallback(async (threadId: string) => {
    const thread = input.threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      return;
    }
    // Ephemeral threads are not in DB — just discard them
    if (input.ephemeralThread && input.ephemeralThread.id === threadId) {
      input.queryClient.removeQueries({ queryKey: bundleQueryKey(threadId) });
      input.setEphemeralThread(null);
    } else {
      const archivedAtMs = Date.now();
      await chatAiStoreClient.updateThreadMetadata({
        id: thread.id,
        title: thread.title,
        updatedAtMs: archivedAtMs,
        lastMessageAtMs: thread.lastMessageAtMs,
        archivedAtMs,
      });
      input.setThreadsCache((current) => current.filter((candidate) => candidate.id !== threadId));
    }
    if (input.activeThreadId === threadId) {
      const remaining = input.threads.filter((candidate) => candidate.id !== threadId);
      const nextThread = remaining[0] || null;
      if (nextThread) {
        syncAiThreadSelectionState(nextThread.id);
      } else {
        syncAiThreadSelectionState(null);
      }
    }
  }, [input, syncAiThreadSelectionState]);

  const handleRenameThread = useCallback((threadId: string, title: string) => {
    const thread = input.threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      return;
    }
    void (async () => {
      const updated = await chatAiStoreClient.updateThreadMetadata({
        id: thread.id,
        title,
        updatedAtMs: Date.now(),
        lastMessageAtMs: thread.lastMessageAtMs,
        archivedAtMs: thread.archivedAtMs,
      });
      input.setThreadsCache((current) => upsertThreadSummary(current, updated));
    })().catch(input.reportHostError);
  }, [input]);

  const handleSelectThread = useCallback((threadId: string) => {
    if (!threadId || threadId === input.activeThreadId || input.submittingThreadId) {
      return;
    }
    const nextThread = input.threads.find((candidate) => candidate.id === threadId) || null;
    if (!nextThread) {
      return;
    }
    // Discard ephemeral thread when switching away from it
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
    const submittedText = text.trim();
    if (!submittedText) {
      return;
    }
    let effectiveThreadId = input.activeThreadId;
    let effectiveThreadRecord = (
      input.ephemeralThread && input.activeThreadId === input.ephemeralThread.id
        ? input.ephemeralThread
        : input.selectedThreadRecord
    );
    const createdAtMs = Date.now();

    if (!effectiveThreadId || !effectiveThreadRecord) {
      const localThread: ChatAiThreadRecord = {
        id: randomIdV11('ai-thread'),
        title: AI_NEW_CONVERSATION_TITLE,
        createdAtMs,
        updatedAtMs: createdAtMs,
        lastMessageAtMs: null,
        archivedAtMs: null,
      };
      input.setEphemeralThread(localThread);
      input.setThreadsCache((current) => upsertThreadSummary(current, localThread));
      input.queryClient.setQueryData(bundleQueryKey(localThread.id), createEmptyBundle(localThread));
      syncAiThreadSelectionState(localThread.id);
      effectiveThreadId = localThread.id;
      effectiveThreadRecord = localThread;
    }

    const fallbackThreadRecord: ChatAiThreadRecord = (
      'createdAtMs' in effectiveThreadRecord
      && typeof effectiveThreadRecord.createdAtMs === 'number'
    )
      ? effectiveThreadRecord as ChatAiThreadRecord
      : {
        ...effectiveThreadRecord,
        createdAtMs,
      };
    const userMessageId = randomIdV11('ai-message-user');
    const assistantMessageId = randomIdV11('ai-message-assistant');
    const userMessage: ChatAiMessageRecord = {
      id: userMessageId,
      threadId: effectiveThreadId,
      role: 'user',
      status: 'complete',
      contentText: submittedText,
      content: createPlainTextMessageContent(submittedText),
      error: null,
      traceId: null,
      parentMessageId: null,
      createdAtMs,
      updatedAtMs: createdAtMs,
    };
    const assistantPlaceholder: ChatAiMessageRecord = {
      id: assistantMessageId,
      threadId: effectiveThreadId,
      role: 'assistant',
      status: 'pending',
      contentText: '',
      content: createPlainTextMessageContent(''),
      error: null,
      traceId: null,
      parentMessageId: userMessageId,
      createdAtMs: createdAtMs + 1,
      updatedAtMs: createdAtMs + 1,
    };

    const optimisticThreadRecord: ChatAiThreadRecord = {
      ...fallbackThreadRecord,
      updatedAtMs: assistantPlaceholder.updatedAtMs,
      lastMessageAtMs: assistantPlaceholder.updatedAtMs,
    };

    input.currentDraftTextRef.current = '';
    input.setSubmittingThreadId(effectiveThreadId);
    let streamedText = '';
    let streamedReasoningText = '';
    let runtimeTraceId: string | null = null;
    let promptTraceId = '';
    let terminalError: ConversationTurnError | null = null;
    let completionEvent: Extract<ConversationTurnEvent, { type: 'turn-completed' }> | null = null;
    let userMessagePersisted = false;
    let recoveredMissingThread = false;
    let threadPersisted = !(
      input.ephemeralThread
      && input.activeThreadId
      && input.ephemeralThread.id === input.activeThreadId
    ) && Boolean(input.selectedThreadRecord && input.activeThreadId === input.selectedThreadRecord.id);

    try {
      input.setThreadsCache((current) => upsertThreadSummary(current, optimisticThreadRecord));
      input.setBundleCache(effectiveThreadId, (current) => {
        const base = current || createEmptyBundle(fallbackThreadRecord);
        return {
          ...base,
          thread: optimisticThreadRecord,
          messages: replaceMessage(replaceMessage(base.messages, userMessage), assistantPlaceholder),
          draft: null,
        };
      });

      await ensureAiConversationSubmitRouteReady({
        t: input.t,
      });
      await assertAiSubmitSchedulingAllowed({
        aiConfig: input.aiConfig,
        t: input.t,
      });

      const persistence = await ensureChatAiThreadRecordPersisted({
        thread: fallbackThreadRecord,
        verifyExisting: !(
          input.ephemeralThread
          && input.ephemeralThread.id === effectiveThreadId
        ),
      });
      effectiveThreadRecord = persistence.thread;
      recoveredMissingThread = persistence.recoveredMissingThread;
      threadPersisted = true;
      input.setThreadsCache((current) => upsertThreadSummary(current, persistence.thread));
      if (input.ephemeralThread && input.ephemeralThread.id === effectiveThreadId) {
        input.setEphemeralThread(null);
      }
      if (recoveredMissingThread) {
        input.setBundleCache(effectiveThreadId, () => ({
          thread: optimisticThreadRecord,
          messages: [userMessage, assistantPlaceholder],
          draft: null,
        }));
      }

      await chatAiStoreClient.deleteDraft(effectiveThreadId);
      input.setBundleCache(effectiveThreadId, (current) => upsertBundleDraft(current, null) || current);

      await chatAiStoreClient.createMessage(userMessage);
      userMessagePersisted = true;
      await chatAiStoreClient.createMessage(assistantPlaceholder);

      const abortController = startStream(effectiveThreadId, STREAM_TEXT_TOTAL_TIMEOUT_MS);
      const history = toConversationHistoryMessages(
        recoveredMissingThread ? [] : (input.bundleMessages || []),
      );
      for await (const event of input.runAiTurn({
        threadId: effectiveThreadId,
        turnId: assistantMessageId,
        userMessage: {
          id: userMessageId,
          text: submittedText,
          attachments: [],
        },
        history,
        signal: abortController.signal,
      })) {
        matchConversationTurnEvent(event, {
          'turn-started': () => undefined,
          'reasoning-delta': (nextEvent) => {
            streamedReasoningText += nextEvent.textDelta;
            feedStreamEvent(effectiveThreadId, {
              type: 'reasoning_delta',
              textDelta: nextEvent.textDelta,
            });
          },
          'text-delta': (nextEvent) => {
            streamedText += nextEvent.textDelta;
            feedStreamEvent(effectiveThreadId, {
              type: 'text_delta',
              textDelta: nextEvent.textDelta,
            });
          },
          'turn-completed': (nextEvent) => {
            completionEvent = nextEvent;
            streamedText = nextEvent.outputText;
            streamedReasoningText = normalizeReasoningText(nextEvent.reasoningText) || streamedReasoningText;
            runtimeTraceId = (nextEvent.trace?.traceId || '').trim() || runtimeTraceId;
            promptTraceId = (nextEvent.trace?.promptTraceId || '').trim() || promptTraceId;
            feedStreamEvent(effectiveThreadId, {
              type: 'done',
              usage: nextEvent.usage,
              finalText: nextEvent.outputText,
              finalReasoningText: normalizeReasoningText(nextEvent.reasoningText) || undefined,
            });
          },
          'turn-failed': (nextEvent) => {
            terminalError = nextEvent.error;
            streamedText = (nextEvent.outputText || '').trim() || streamedText;
            streamedReasoningText = normalizeReasoningText(nextEvent.reasoningText) || streamedReasoningText;
            runtimeTraceId = (nextEvent.trace?.traceId || '').trim() || runtimeTraceId;
            promptTraceId = (nextEvent.trace?.promptTraceId || '').trim() || promptTraceId;
          },
          'turn-canceled': (nextEvent) => {
            runtimeTraceId = (nextEvent.trace?.traceId || '').trim() || runtimeTraceId;
            promptTraceId = (nextEvent.trace?.promptTraceId || '').trim() || promptTraceId;
            throw toAbortError(input.t('Chat.aiGenerationStopped', { defaultValue: 'Generation stopped.' }));
          },
          'message-sealed': () => {
            throw new Error('simple-ai provider emitted unsupported message-sealed event');
          },
          'beat-planned': () => {
            throw new Error('simple-ai provider emitted unsupported beat-planned event');
          },
          'beat-delivery-started': () => {
            throw new Error('simple-ai provider emitted unsupported beat-delivery-started event');
          },
          'beat-delivered': () => {
            throw new Error('simple-ai provider emitted unsupported beat-delivered event');
          },
          'artifact-ready': () => {
            throw new Error('simple-ai provider emitted unsupported artifact-ready event');
          },
          'projection-rebuilt': () => {
            throw new Error('simple-ai provider emitted unsupported projection-rebuilt event');
          },
        });
      }
      if (terminalError) {
        throw toStructuredProviderError(terminalError);
      }
      if (!completionEvent) {
        throw new Error('simple-ai provider completed without a terminal event');
      }

      const completedState = getStreamState(effectiveThreadId);
      const finalText = stripBeatActionEnvelopeIfPresent(completedState.partialText || streamedText);
      const finalReasoningText = completedState.partialReasoningText || streamedReasoningText;

      const assistantMessage = await chatAiStoreClient.updateMessage({
        id: assistantMessageId,
        status: 'complete',
        contentText: finalText,
        content: createAssistantMessageContent(finalText, finalReasoningText),
        error: null,
        traceId: runtimeTraceId || promptTraceId || null,
        updatedAtMs: Date.now(),
      });
      const updatedThread = await chatAiStoreClient.updateThreadMetadata({
        id: effectiveThreadRecord.id,
        title: resolveThreadTitleAfterFirstSend(effectiveThreadRecord.title, submittedText),
        updatedAtMs: Date.now(),
        lastMessageAtMs: assistantMessage.updatedAtMs,
        archivedAtMs: effectiveThreadRecord.archivedAtMs,
      });
      input.setThreadsCache((current) => upsertThreadSummary(current, updatedThread));
      input.setBundleCache(effectiveThreadId, (current) => {
        const base = current || createEmptyBundle(updatedThread);
        return {
          ...base,
          thread: updatedThread,
          messages: replaceMessage(base.messages, assistantMessage),
          draft: null,
        };
      });
      input.currentDraftTextRef.current = '';
      syncAiThreadSelectionState(effectiveThreadId);
    } catch (error) {
      const streamSnapshot = getStreamState(effectiveThreadId);
      const partialText = streamSnapshot.partialText || streamedText;
      const partialReasoningText = streamSnapshot.partialReasoningText || streamedReasoningText;
      const runtimeError = streamSnapshot.cancelSource === 'user'
        ? {
          code: 'OPERATION_ABORTED',
          message: input.t('Chat.aiGenerationStopped', { defaultValue: 'Generation stopped.' }),
        }
        : toChatAiRuntimeError(error);
      if (streamSnapshot.phase === 'waiting' || streamSnapshot.phase === 'streaming') {
        feedStreamEvent(effectiveThreadId, {
          type: 'error',
          message: runtimeError.message,
          reasonCode: runtimeError.code,
          traceId: streamSnapshot.traceId || runtimeTraceId || promptTraceId || undefined,
        });
      }
      const recoveredDraftUpdatedAtMs = Date.now();
      const draft = threadPersisted
        ? await chatAiStoreClient.putDraft({
          threadId: effectiveThreadId,
          text: submittedText,
          attachments: [],
          updatedAtMs: recoveredDraftUpdatedAtMs,
        }).catch(() => null)
        : null;
      input.setThreadsCache((current) => upsertThreadSummary(current, fallbackThreadRecord));
      try {
        const assistantError = await chatAiStoreClient.updateMessage({
          id: assistantMessageId,
          status: 'error',
          contentText: partialText,
          content: createAssistantMessageContent(partialText, partialReasoningText),
          error: runtimeError,
          traceId: streamSnapshot.traceId || runtimeTraceId || promptTraceId || null,
          updatedAtMs: Date.now(),
        });
        input.setBundleCache(effectiveThreadId, (current) => {
          const base = current || createEmptyBundle(fallbackThreadRecord);
          const messagesWithoutPlaceholder = base.messages.filter((message) => message.id !== assistantMessageId);
          return {
            ...base,
            thread: fallbackThreadRecord,
            messages: replaceMessage(replaceMessage(messagesWithoutPlaceholder, userMessage), assistantError),
            draft: draft || {
              threadId: effectiveThreadId,
              text: submittedText,
              attachments: [],
              updatedAtMs: recoveredDraftUpdatedAtMs,
            },
          };
        });
      } catch {
        input.setBundleCache(effectiveThreadId, (current) => {
          const base = current || createEmptyBundle(fallbackThreadRecord);
          const messagesWithoutOptimisticPlaceholder = base.messages
            .filter((message) => message.id !== assistantMessageId);
          return {
            ...base,
            thread: fallbackThreadRecord,
            messages: !userMessagePersisted
              ? messagesWithoutOptimisticPlaceholder.filter((message) => message.id !== userMessageId)
              : replaceMessage(messagesWithoutOptimisticPlaceholder, userMessage),
            draft: draft || {
              threadId: effectiveThreadId,
              text: submittedText,
              attachments: [],
              updatedAtMs: recoveredDraftUpdatedAtMs,
            },
          };
        });
      }
      input.currentDraftTextRef.current = submittedText;
      const propagatedError = new Error(runtimeError.message, { cause: error });
      input.reportHostError(propagatedError);
      throw propagatedError;
    } finally {
      input.setSubmittingThreadId(null);
    }
  }, [input, syncAiThreadSelectionState]);

  return {
    handleArchiveThread,
    handleCreateThread,
    handleRenameThread,
    handleSelectThread,
    handleSubmit,
  };
}
