import {
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConversationOrchestrationRegistry,
  matchConversationTurnEvent,
  type ConversationTurnError,
  type ConversationTurnEvent,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { createSimpleAiConversationProvider } from '@nimiplatform/nimi-kit/features/chat/runtime';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import {
  type ChatAiMessageRecord,
  type ChatAiThreadBundle,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAiStoreClient } from '@renderer/bridge/runtime-bridge/chat-ai-store';
import { randomIdV11, type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { useTranslation } from 'react-i18next';
import { toChatAiRuntimeError } from './chat-ai-runtime';
import { resolveAiConversationRouteReadiness, type AiConversationRouteReadiness } from './chat-ai-route-readiness';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import {
  AI_NEW_CONVERSATION_TITLE,
  createAssistantMessageContent,
  createPlainTextMessageContent,
  getAiRouteDisplaySummary,
  hasAiConversationThread,
  isAiRouteSnapshotEqual,
  resolveAiConversationActiveThreadId,
  resolveThreadTitleAfterFirstSend,
  toAiRouteSnapshotFromResolvedRoute,
  toConversationMessageViewModel,
} from './chat-ai-thread-model';
import type { AiConversationRouteSnapshot, AiConversationSelection } from './chat-shell-types';
import {
  createReasoningMessageContentRenderer,
  RuntimeStreamFooter,
  useConversationStreamState,
} from './chat-runtime-stream-ui';
import { composeDesktopChatSystemPrompt } from './chat-output-contract';
import {
  getChatThinkingUnsupportedCopy,
  resolveAiChatThinkingSupport,
} from './chat-thinking';
import {
  feedStreamEvent,
  getStreamState,
  startStream,
  STREAM_TEXT_TOTAL_TIMEOUT_MS,
} from '../turns/stream-controller';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  bundleQueryKey,
  createEmptyBundle,
  isEmptyPendingAssistantMessage,
  normalizeText,
  normalizeReasoningText,
  replaceMessage,
  sortThreadSummaries,
  THREADS_QUERY_KEY,
  toAbortError,
  toConversationHistoryMessages,
  toErrorMessage,
  toStructuredProviderError,
  upsertBundleDraft,
  upsertThreadSummary,
} from './chat-ai-shell-core';
import { useAiConversationPresentation } from './chat-ai-shell-presentation';
import { createChatAiConversationRuntimeAdapter } from './chat-ai-shell-runtime-adapter';
import { useAiConversationEffects } from './chat-ai-shell-effects';

type UseAiConversationModeHostInput = {
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AiConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AiConversationSelection) => void;
};


export function useAiConversationModeHost(
  input: UseAiConversationModeHostInput,
): { host: DesktopConversationModeHost; readiness: AiConversationRouteReadiness } {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const chatThinkingPreference = useAppStore((state) => state.chatThinkingPreference);
  const setChatThinkingPreference = useAppStore((state) => state.setChatThinkingPreference);
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const currentDraftTextRef = useRef('');
  const reportHostError = useCallback((error: unknown) => {
    setHostFeedback({
      kind: 'error',
      message: toErrorMessage(error),
    });
  }, []);

  const setSelection = useCallback((selection: AiConversationSelection) => {
    if (
      input.selection.threadId === selection.threadId
      && isAiRouteSnapshotEqual(input.selection.routeSnapshot, selection.routeSnapshot)
    ) {
      return;
    }
    input.setSelection(selection);
  }, [input]);

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => chatAiStoreClient.listThreads(),
  });

  const threads = useMemo(
    () => sortThreadSummaries(threadsQuery.data || []),
    [threadsQuery.data],
  );

  const activeThreadId = useMemo(
    () => resolveAiConversationActiveThreadId({
      threads,
      selectionThreadId: input.selection.threadId,
      lastSelectedThreadId: input.lastSelectedThreadId,
    }),
    [input.lastSelectedThreadId, input.selection.threadId, threads],
  );

  const selectedThreadRecord = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads],
  );

  const readinessPreference = selectedThreadRecord?.routeSnapshot || input.selection.routeSnapshot || null;
  const readiness = useMemo(
    () => resolveAiConversationRouteReadiness({
      runtimeConfigState: input.runtimeConfigState,
      routeSnapshot: readinessPreference,
    }),
    [input.runtimeConfigState, readinessPreference],
  );

  const availableRouteSnapshots = useMemo(() => (
    readiness.readyRoutes
      .map((route) => toAiRouteSnapshotFromResolvedRoute(
        route,
        input.runtimeConfigState,
        readinessPreference,
      ))
      .filter((route): route is AiConversationRouteSnapshot => Boolean(route))
      .filter((route, index, routes) => routes.findIndex((candidate) => (
        isAiRouteSnapshotEqual(candidate, route)
      )) === index)
  ), [input.runtimeConfigState, readiness.readyRoutes, readinessPreference]);

  const defaultRouteSnapshot = useMemo(
    () => toAiRouteSnapshotFromResolvedRoute(
      readiness.preferredRoute || readiness.defaultRoute,
      input.runtimeConfigState,
      readinessPreference,
    ),
    [input.runtimeConfigState, readiness.defaultRoute, readiness.preferredRoute, readinessPreference],
  );

  const currentRouteSnapshot = selectedThreadRecord?.routeSnapshot
    || input.selection.routeSnapshot
    || defaultRouteSnapshot;
  const thinkingSupport = useMemo(
    () => resolveAiChatThinkingSupport(currentRouteSnapshot),
    [currentRouteSnapshot],
  );
  const thinkingUnsupportedReason = useMemo(() => {
    if (thinkingSupport.supported || !thinkingSupport.reason) {
      return null;
    }
    const copy = getChatThinkingUnsupportedCopy(thinkingSupport.reason);
    return t(copy.key, { defaultValue: copy.defaultValue });
  }, [t, thinkingSupport]);

  const bundleQuery = useQuery({
    queryKey: activeThreadId ? bundleQueryKey(activeThreadId) : ['chat-ai-thread-bundle', 'inactive'],
    queryFn: () => chatAiStoreClient.getThreadBundle(activeThreadId as string),
    enabled: Boolean(activeThreadId),
  });

  const bundle = bundleQuery.data || null;
  const messages = useMemo(
    () => (bundle?.messages || [])
      .map((message: ChatAiMessageRecord) => toConversationMessageViewModel(message))
      .filter((message) => !isEmptyPendingAssistantMessage(message)),
    [bundle?.messages],
  );
  const streamState = useConversationStreamState(activeThreadId);
  const aiProvider = useMemo(() => {
    if (!currentRouteSnapshot || !activeThreadId) {
      return null;
    }
    const registry = new ConversationOrchestrationRegistry();
    registry.register(createSimpleAiConversationProvider({
      runtimeAdapter: createChatAiConversationRuntimeAdapter({
        routeSnapshot: currentRouteSnapshot,
        threadId: activeThreadId,
        reasoningPreference: chatThinkingPreference,
        runtimeConfigState: input.runtimeConfigState,
        runtimeFields: input.runtimeFields,
      }),
      resolveSystemPrompt: (turnInput) => composeDesktopChatSystemPrompt(turnInput.systemPrompt),
    }));
    return registry.require('simple-ai');
  }, [
    activeThreadId,
    chatThinkingPreference,
    currentRouteSnapshot,
    input.runtimeConfigState,
    input.runtimeFields,
  ]);

  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;
  // Composer is available whenever setup is ready — don't gate on activeThreadId
  // so that the composer shows before auto-create finishes.
  const composerReady = readiness.setupState.status === 'ready'
    && !isBundleLoading
    && !bundleQuery.error;

  const {
    setBundleCache,
    setThreadsCache,
    syncSelectionToThread,
  } = useAiConversationEffects({
    queryClient,
    setSelection,
  });

  useEffect(() => {
    if (!threadsQuery.isSuccess) {
      return;
    }
    if (input.selection.threadId && !hasAiConversationThread(threads, input.selection.threadId)) {
      setSelection({
        threadId: null,
        routeSnapshot: input.selection.routeSnapshot,
      });
      return;
    }
    if (!input.selection.threadId && activeThreadId && selectedThreadRecord) {
      syncSelectionToThread(activeThreadId, selectedThreadRecord.routeSnapshot);
    }
  }, [
    activeThreadId,
    input.selection.routeSnapshot,
    input.selection.threadId,
    selectedThreadRecord,
    setSelection,
    syncSelectionToThread,
    threads,
    threadsQuery.isSuccess,
  ]);

  useEffect(() => {
    currentDraftTextRef.current = bundle?.draft?.text || '';
  }, [activeThreadId, bundle?.draft?.text, bundle?.draft?.updatedAtMs]);

  const persistDraftForThread = useCallback(async (threadId: string | null) => {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const nextText = currentDraftTextRef.current;
    if (nextText.trim()) {
      const draft = await chatAiStoreClient.putDraft({
        threadId: normalizedThreadId,
        text: nextText,
        attachments: [],
        updatedAtMs: Date.now(),
      });
      setBundleCache(
        normalizedThreadId,
        (current: ChatAiThreadBundle | null | undefined) => upsertBundleDraft(current, draft) || current,
      );
      return;
    }
    await chatAiStoreClient.deleteDraft(normalizedThreadId);
    setBundleCache(
      normalizedThreadId,
      (current: ChatAiThreadBundle | null | undefined) => upsertBundleDraft(current, null) || current,
    );
  }, [setBundleCache]);

  const handleCreateThread = useCallback(async () => {
    if (readiness.setupState.status !== 'ready' || !currentRouteSnapshot) {
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
      routeSnapshot: currentRouteSnapshot,
    });
    setThreadsCache((current) => upsertThreadSummary(current, thread));
    queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyBundle(thread));
    currentDraftTextRef.current = '';
    syncSelectionToThread(thread.id, thread.routeSnapshot);
  }, [currentRouteSnapshot, queryClient, readiness.setupState.status, setThreadsCache, syncSelectionToThread]);

  const handleArchiveThread = useCallback(async (threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
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
      routeSnapshot: thread.routeSnapshot,
    });
    setThreadsCache((current) => current.filter((t) => t.id !== threadId));
    // If the archived thread was active, switch to the next available thread
    if (activeThreadId === threadId) {
      const remaining = threads.filter((t) => t.id !== threadId);
      const next = remaining[0] || null;
      if (next) {
        syncSelectionToThread(next.id, next.routeSnapshot);
      } else {
        setSelection({ threadId: null, routeSnapshot: null });
      }
    }
  }, [activeThreadId, setSelection, setThreadsCache, syncSelectionToThread, threads]);

  const handleRenameThread = useCallback((threadId: string, title: string) => {
    const thread = threads.find((t) => t.id === threadId);
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
        routeSnapshot: thread.routeSnapshot,
      });
      setThreadsCache((current) => upsertThreadSummary(current, updated));
    })().catch(reportHostError);
  }, [reportHostError, setThreadsCache, threads]);

  // Auto-create the first AI thread when route is ready and no thread exists.
  // Subsequent threads are created by the user via the session list panel.
  const autoCreatingRef = useRef(false);
  useEffect(() => {
    if (readiness.setupState.status !== 'ready' || !currentRouteSnapshot) {
      return;
    }
    if (threads.length > 0 || autoCreatingRef.current) {
      return;
    }
    autoCreatingRef.current = true;
    void handleCreateThread()
      .catch(reportHostError)
      .finally(() => { autoCreatingRef.current = false; });
  }, [currentRouteSnapshot, handleCreateThread, readiness.setupState.status, reportHostError, threads.length]);

  const handleSelectThread = useCallback((threadId: string) => {
    if (!threadId || threadId === activeThreadId || submittingThreadId) {
      return;
    }
    const nextThread = threads.find((thread) => thread.id === threadId) || null;
    if (!nextThread) {
      return;
    }
    void (async () => {
      await persistDraftForThread(activeThreadId);
      currentDraftTextRef.current = '';
      syncSelectionToThread(threadId, nextThread.routeSnapshot);
    })().catch(reportHostError);
  }, [activeThreadId, persistDraftForThread, reportHostError, submittingThreadId, syncSelectionToThread, threads]);

  const handleRouteSelection = useCallback((routeSnapshot: AiConversationRouteSnapshot) => {
    if (submittingThreadId) {
      return;
    }
    void (async () => {
      if (!selectedThreadRecord) {
        syncSelectionToThread(null, routeSnapshot);
        return;
      }
      const updatedThread = await chatAiStoreClient.updateThreadMetadata({
        id: selectedThreadRecord.id,
        title: selectedThreadRecord.title,
        updatedAtMs: Date.now(),
        lastMessageAtMs: selectedThreadRecord.lastMessageAtMs,
        archivedAtMs: selectedThreadRecord.archivedAtMs,
        routeSnapshot,
      });
      setThreadsCache((current) => upsertThreadSummary(current, updatedThread));
      setBundleCache(updatedThread.id, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          thread: updatedThread,
        };
      });
      syncSelectionToThread(updatedThread.id, updatedThread.routeSnapshot);
    })().catch(reportHostError);
  }, [reportHostError, selectedThreadRecord, setBundleCache, setThreadsCache, submittingThreadId, syncSelectionToThread]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!currentRouteSnapshot || !aiProvider) {
      throw new Error(t('Chat.aiSubmitMissingThread', { defaultValue: 'Select a conversation before sending a message.' }));
    }
    if (readiness.setupState.status !== 'ready') {
      throw new Error(t('Chat.aiSubmitRouteUnavailable', { defaultValue: 'Choose a ready AI route before sending a message.' }));
    }

    const submittedText = text.trim();
    if (!submittedText) {
      return;
    }

    // Lazy thread creation: if no active thread, create one before sending
    let effectiveThreadId = activeThreadId;
    let effectiveThreadRecord = selectedThreadRecord;
    if (!effectiveThreadId || !effectiveThreadRecord) {
      const timestampMs = Date.now();
      const newThread = await chatAiStoreClient.createThread({
        id: randomIdV11('ai-thread'),
        title: AI_NEW_CONVERSATION_TITLE,
        createdAtMs: timestampMs,
        updatedAtMs: timestampMs,
        lastMessageAtMs: null,
        archivedAtMs: null,
        routeSnapshot: currentRouteSnapshot,
      });
      setThreadsCache((current) => upsertThreadSummary(current, newThread));
      queryClient.setQueryData(bundleQueryKey(newThread.id), createEmptyBundle(newThread));
      syncSelectionToThread(newThread.id, newThread.routeSnapshot);
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

    currentDraftTextRef.current = submittedText;
    setSubmittingThreadId(effectiveThreadId);
    let streamedText = '';
    let streamedReasoningText = '';
    let runtimeTraceId: string | null = null;
    let promptTraceId = '';
    let terminalError: ConversationTurnError | null = null;
    let completionEvent: Extract<ConversationTurnEvent, { type: 'turn-completed' }> | null = null;

    try {
      await chatAiStoreClient.deleteDraft(effectiveThreadId);
      setBundleCache(effectiveThreadId, (current) => upsertBundleDraft(current, null) || current);

      await chatAiStoreClient.createMessage(userMessage);
      await chatAiStoreClient.createMessage(assistantPlaceholder);
      setBundleCache(effectiveThreadId, (current) => {
        const base = current || createEmptyBundle({
          ...effectiveThreadRecord,
          createdAtMs,
        });
        return {
          ...base,
          messages: replaceMessage(
            replaceMessage(base.messages, userMessage),
            assistantPlaceholder,
          ),
          draft: null,
        };
      });

      const abortController = startStream(effectiveThreadId, STREAM_TEXT_TOTAL_TIMEOUT_MS);
      const history = toConversationHistoryMessages(bundle?.messages || []);
      for await (const event of aiProvider.runTurn({
        modeId: 'simple-ai',
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
            runtimeTraceId = normalizeText(nextEvent.trace?.traceId) || runtimeTraceId;
            promptTraceId = normalizeText(nextEvent.trace?.promptTraceId) || promptTraceId;
            feedStreamEvent(effectiveThreadId, {
              type: 'done',
              usage: nextEvent.usage,
              finalText: nextEvent.outputText,
              finalReasoningText: normalizeReasoningText(nextEvent.reasoningText) || undefined,
            });
          },
          'turn-failed': (nextEvent) => {
            terminalError = nextEvent.error;
            streamedText = normalizeText(nextEvent.outputText) || streamedText;
            streamedReasoningText = normalizeReasoningText(nextEvent.reasoningText) || streamedReasoningText;
            runtimeTraceId = normalizeText(nextEvent.trace?.traceId) || runtimeTraceId;
            promptTraceId = normalizeText(nextEvent.trace?.promptTraceId) || promptTraceId;
          },
          'turn-canceled': (nextEvent) => {
            runtimeTraceId = normalizeText(nextEvent.trace?.traceId) || runtimeTraceId;
            promptTraceId = normalizeText(nextEvent.trace?.promptTraceId) || promptTraceId;
            throw toAbortError(t('Chat.aiGenerationStopped', { defaultValue: 'Generation stopped.' }));
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
        routeSnapshot: currentRouteSnapshot,
      });
      setThreadsCache((current) => upsertThreadSummary(current, updatedThread));
      setBundleCache(effectiveThreadId, (current) => {
        const base = current || createEmptyBundle(updatedThread);
        return {
          ...base,
          thread: updatedThread,
          messages: replaceMessage(base.messages, assistantMessage),
          draft: null,
        };
      });
      currentDraftTextRef.current = '';
      syncSelectionToThread(effectiveThreadId, updatedThread.routeSnapshot);
    } catch (error) {
      const streamSnapshot = getStreamState(effectiveThreadId);
      const partialText = streamSnapshot.partialText || streamedText;
      const partialReasoningText = streamSnapshot.partialReasoningText || streamedReasoningText;
      const runtimeError = streamSnapshot.cancelSource === 'user'
        ? {
          code: 'OPERATION_ABORTED',
          message: t('Chat.aiGenerationStopped', { defaultValue: 'Generation stopped.' }),
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
      setBundleCache(effectiveThreadId, (current) => upsertBundleDraft(current, draft) || current);
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
        setBundleCache(effectiveThreadId, (current) => {
          const base = current || createEmptyBundle({
            ...effectiveThreadRecord,
            createdAtMs,
          });
          return {
            ...base,
            messages: replaceMessage(
              replaceMessage(base.messages, userMessage),
              assistantError,
            ),
            draft,
          };
        });
      } catch {
        setBundleCache(effectiveThreadId, (current) => {
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
      currentDraftTextRef.current = submittedText;
      throw new Error(runtimeError.message, {
        cause: error,
      });
    } finally {
      setSubmittingThreadId(null);
    }
  }, [
    activeThreadId,
    aiProvider,
    bundle?.messages,
    currentRouteSnapshot,
    chatThinkingPreference,
    input.runtimeConfigState,
    input.runtimeFields,
    queryClient,
    readiness.setupState.status,
    selectedThreadRecord,
    setBundleCache,
    setThreadsCache,
    syncSelectionToThread,
    t,
  ]);

  const routeSummary = getAiRouteDisplaySummary(currentRouteSnapshot, input.runtimeConfigState);
  const aiCharacterData = useMemo(() => ({
    name: t('Chat.aiAssistantName', { defaultValue: 'AI Assistant' }),
    avatarUrl: null,
    avatarFallback: 'AI',
    handle: routeSummary.detail || null,
    bio: null,
    interactionState: {
      phase: submittingThreadId ? 'thinking' as const : 'idle' as const,
      busy: Boolean(submittingThreadId),
    },
    theme: {
      roomSurface: 'linear-gradient(180deg, rgba(250,252,252,0.98), rgba(244,247,248,0.96))',
      roomAura: 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(232,245,245,0.78))',
      accentSoft: 'rgba(125,211,252,0.22)',
      accentStrong: '#38bdf8',
      border: 'rgba(56,189,248,0.34)',
      text: '#0c4a6e',
    },
  }), [routeSummary.detail, submittingThreadId, t]);
  const syntheticTarget = useMemo(() => ({
    id: 'ai:assistant',
    source: 'ai' as const,
    canonicalSessionId: activeThreadId || 'ai:assistant',
    title: aiCharacterData.name,
    handle: null,
    bio: aiCharacterData.bio || null,
    avatarUrl: aiCharacterData.avatarUrl || null,
    avatarFallback: aiCharacterData.avatarFallback || 'AI',
    previewText: messages[messages.length - 1]?.text || null,
    updatedAt: selectedThreadRecord ? new Date(selectedThreadRecord.updatedAtMs).toISOString() : null,
    unreadCount: 0,
    status: 'active' as const,
    isOnline: readiness.localReady || readiness.cloudReady,
    metadata: {
      routeLabel: routeSummary.label,
    },
  }), [
    activeThreadId,
    aiCharacterData.avatarFallback,
    aiCharacterData.avatarUrl,
    aiCharacterData.bio,
    aiCharacterData.name,
    messages,
    readiness.cloudReady,
    readiness.localReady,
    routeSummary.label,
    selectedThreadRecord,
  ]);
  const aiAssistantName = aiCharacterData.name;
  const canonicalMessages = useMemo(
    () => messages.map((message) => {
      const isUser = message.role === 'user' || message.role === 'human';
      return {
        id: message.id,
        sessionId: activeThreadId || 'ai:assistant',
        targetId: 'ai:assistant',
        source: 'ai' as const,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        status: message.status,
        error: message.error,
        kind: 'text' as const,
        senderName: isUser ? 'You' : aiAssistantName,
        senderKind: isUser ? ('human' as const) : ('ai' as const),
        metadata: message.metadata,
      };
    }),
    [activeThreadId, aiAssistantName, messages],
  );
  const reasoningLabel = t('Chat.reasoningLabel', { defaultValue: 'Thought process' });
  const renderMessageContent = useMemo(
    () => createReasoningMessageContentRenderer(reasoningLabel),
    [reasoningLabel],
  );
  const footerContent = useMemo<ReactNode>(() => {
    if (!activeThreadId) {
      return null;
    }
    return (
      <RuntimeStreamFooter
        chatId={activeThreadId}
        assistantName={aiCharacterData.name}
        assistantAvatarUrl={aiCharacterData.avatarUrl || null}
        assistantKind="agent"
        streamState={streamState}
        stopLabel={t('ChatTimeline.stopGenerating', 'Stop generating')}
        interruptedLabel={t('ChatTimeline.streamInterrupted', 'Response interrupted')}
        reasoningLabel={reasoningLabel}
      />
    );
  }, [activeThreadId, aiCharacterData.avatarUrl, aiCharacterData.name, reasoningLabel, streamState, t]);
  const pendingFirstBeat = Boolean(
    streamState
    && streamState.phase === 'waiting'
    && !streamState.partialText
    && !streamState.partialReasoningText,
  );
  const host = useAiConversationPresentation({
    activeThreadId,
    aiCharacterData,
    availableRouteSnapshots,
    bundle,
    bundleError: bundleQuery.error,
    canonicalMessages,
    composerReady,
    currentDraftTextRef,
    currentRouteSnapshot,
    footerContent,
    handleArchiveThread,
    handleCreateThread,
    handleRenameThread,
    handleRouteSelection,
    handleSelectThread,
    handleSubmit,
    hostFeedback,
    isBundleLoading,
    messages,
    onDismissHostFeedback: () => setHostFeedback(null),
    pendingFirstBeat,
    readiness: {
      cloudReady: readiness.cloudReady,
      localReady: readiness.localReady,
      setupState: readiness.setupState,
    },
    renderMessageContent,
    routeSummary,
    runtimeConfigState: input.runtimeConfigState,
    setChatThinkingPreference,
    submittingThreadId,
    syntheticTarget,
    t,
    thinkingPreference: chatThinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    threads,
  });

  return { host, readiness };
}
