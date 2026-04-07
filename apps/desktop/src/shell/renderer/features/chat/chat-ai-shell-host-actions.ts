import { useCallback, useEffect, useRef } from 'react';
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
  toAbortError,
  toConversationHistoryMessages,
  toStructuredProviderError,
  upsertBundleDraft,
  upsertThreadSummary,
} from './chat-ai-shell-core';

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
  bundleMessages: readonly ChatAiMessageRecord[] | undefined;
  currentDraftTextRef: { current: string };
  queryClient: QueryClient;
  reportHostError: (error: unknown) => void;
  runAiTurn: AiRunTurn | null;
  selectedThreadRecord: ChatAiThreadSummary | null;
  setBundleCache: (
    threadId: string,
    updater: (current: ChatAiThreadBundle | null | undefined) => ChatAiThreadBundle | null | undefined,
  ) => void;
  setSubmittingThreadId: (threadId: string | null) => void;
  setThreadsCache: (updater: (current: ChatAiThreadSummary[]) => ChatAiThreadSummary[]) => void;
  setupReady: boolean;
  submittingThreadId: string | null;
  syncSelectionToThread: (threadId: string | null) => void;
  t: TFunction;
  threads: readonly ChatAiThreadSummary[];
};

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
    if (!input.setupReady) {
      return;
    }
    const timestampMs = Date.now();
    const thread = await chatAiStoreClient.createThread({
      id: randomIdV11('ai-thread'),
      title: AI_NEW_CONVERSATION_TITLE,
      createdAtMs: timestampMs,
      updatedAtMs: timestampMs,
      lastMessageAtMs: null,
      archivedAtMs: null,
    });
    input.setThreadsCache((current) => upsertThreadSummary(current, thread));
    input.queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyBundle(thread));
    input.currentDraftTextRef.current = '';
    syncAiThreadSelectionState(thread.id);
  }, [input]);

  const handleArchiveThread = useCallback(async (threadId: string) => {
    const thread = input.threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      return;
    }
    const archivedAtMs = Date.now();
    await chatAiStoreClient.updateThreadMetadata({
      id: thread.id,
      title: thread.title,
      updatedAtMs: archivedAtMs,
      lastMessageAtMs: thread.lastMessageAtMs,
      archivedAtMs,
    });
    input.setThreadsCache((current) => current.filter((candidate) => candidate.id !== threadId));
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

  const autoCreatingRef = useRef(false);
  useEffect(() => {
    if (!input.setupReady) {
      return;
    }
    if (input.threads.length > 0 || autoCreatingRef.current) {
      return;
    }
    autoCreatingRef.current = true;
    void handleCreateThread()
      .catch(input.reportHostError)
      .finally(() => {
        autoCreatingRef.current = false;
      });
  }, [handleCreateThread, input.reportHostError, input.setupReady, input.threads.length]);

  const handleSelectThread = useCallback((threadId: string) => {
    if (!threadId || threadId === input.activeThreadId || input.submittingThreadId) {
      return;
    }
    const nextThread = input.threads.find((candidate) => candidate.id === threadId) || null;
    if (!nextThread) {
      return;
    }
    void (async () => {
      await persistDraftForThread(input.activeThreadId);
      input.currentDraftTextRef.current = '';
      syncAiThreadSelectionState(threadId);
    })().catch(input.reportHostError);
  }, [input, persistDraftForThread, syncAiThreadSelectionState]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!input.runAiTurn) {
      throw new Error(input.t('Chat.aiSubmitRouteUnavailable', {
        defaultValue: 'Choose a ready AI route before sending a message.',
      }));
    }
    if (!input.setupReady) {
      throw new Error(input.t('Chat.aiSubmitRouteUnavailable', {
        defaultValue: 'Choose a ready AI route before sending a message.',
      }));
    }

    const submittedText = text.trim();
    if (!submittedText) {
      return;
    }

    let effectiveThreadId = input.activeThreadId;
    let effectiveThreadRecord = input.selectedThreadRecord;
    if (!effectiveThreadId || !effectiveThreadRecord) {
      const timestampMs = Date.now();
      const newThread = await chatAiStoreClient.createThread({
        id: randomIdV11('ai-thread'),
        title: AI_NEW_CONVERSATION_TITLE,
        createdAtMs: timestampMs,
        updatedAtMs: timestampMs,
        lastMessageAtMs: null,
        archivedAtMs: null,
      });
      input.setThreadsCache((current) => upsertThreadSummary(current, newThread));
      input.queryClient.setQueryData(bundleQueryKey(newThread.id), createEmptyBundle(newThread));
      syncAiThreadSelectionState(newThread.id);
      effectiveThreadId = newThread.id;
      effectiveThreadRecord = newThread;
    }

    const userMessageId = randomIdV11('ai-message-user');
    const assistantMessageId = randomIdV11('ai-message-assistant');
    const createdAtMs = Date.now();
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

    input.currentDraftTextRef.current = submittedText;
    input.setSubmittingThreadId(effectiveThreadId);
    let streamedText = '';
    let streamedReasoningText = '';
    let runtimeTraceId: string | null = null;
    let promptTraceId = '';
    let terminalError: ConversationTurnError | null = null;
    let completionEvent: Extract<ConversationTurnEvent, { type: 'turn-completed' }> | null = null;

    try {
      await chatAiStoreClient.deleteDraft(effectiveThreadId);
      input.setBundleCache(effectiveThreadId, (current) => upsertBundleDraft(current, null) || current);

      await chatAiStoreClient.createMessage(userMessage);
      await chatAiStoreClient.createMessage(assistantPlaceholder);
      input.setBundleCache(effectiveThreadId, (current) => {
        const base = current || createEmptyBundle({
          ...effectiveThreadRecord,
          createdAtMs,
        });
        return {
          ...base,
          messages: replaceMessage(replaceMessage(base.messages, userMessage), assistantPlaceholder),
          draft: null,
        };
      });

      const abortController = startStream(effectiveThreadId, STREAM_TEXT_TOTAL_TIMEOUT_MS);
      const history = toConversationHistoryMessages(input.bundleMessages || []);
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
          'first-beat-sealed': () => {
            throw new Error('simple-ai provider emitted unsupported first-beat event');
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
      const finalText = completedState.partialText || streamedText;
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
      const draft = await chatAiStoreClient.putDraft({
        threadId: effectiveThreadId,
        text: submittedText,
        attachments: [],
        updatedAtMs: Date.now(),
      });
      input.setBundleCache(effectiveThreadId, (current) => upsertBundleDraft(current, draft) || current);
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
          const base = current || createEmptyBundle({
            ...effectiveThreadRecord,
            createdAtMs,
          });
          return {
            ...base,
            messages: replaceMessage(replaceMessage(base.messages, userMessage), assistantError),
            draft,
          };
        });
      } catch {
        input.setBundleCache(effectiveThreadId, (current) => {
          const base = current || createEmptyBundle({
            ...effectiveThreadRecord,
            createdAtMs,
          });
          return {
            ...base,
            messages: replaceMessage(base.messages, userMessage),
            draft,
          };
        });
      }
      input.currentDraftTextRef.current = submittedText;
      throw new Error(runtimeError.message, { cause: error });
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
