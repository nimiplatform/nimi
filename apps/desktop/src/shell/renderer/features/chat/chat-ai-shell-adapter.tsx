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
  CanonicalDrawerSection,
  CanonicalComposer,
  type ChatComposerSubmitInput,
} from '@nimiplatform/nimi-kit/features/chat';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import {
  type ChatAiDraftRecord,
  type ChatAiMessageRecord,
  type ChatAiThreadBundle,
  type ChatAiThreadRecord,
  type ChatAiThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAiStoreClient } from '@renderer/bridge/runtime-bridge/chat-ai-store';
import { randomIdV11, type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { useTranslation } from 'react-i18next';
import {
  streamChatAiRuntime,
  toChatAiRuntimeError,
} from './chat-ai-runtime';
import { resolveAiConversationRouteReadiness, type AiConversationRouteReadiness } from './chat-ai-route-readiness';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import { ChatSettingsPanel } from './chat-settings-panel';
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
  toConversationThreadSummary,
} from './chat-ai-thread-model';
import type { AiConversationRouteSnapshot, AiConversationSelection } from './chat-shell-types';
import {
  createReasoningMessageContentRenderer,
  RuntimeStreamFooter,
  useConversationStreamState,
} from './chat-runtime-stream-ui';
import {
  feedStreamEvent,
  getStreamState,
  startStream,
  STREAM_TEXT_TOTAL_TIMEOUT_MS,
} from '../turns/stream-controller';

type UseAiConversationModeHostInput = {
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AiConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AiConversationSelection) => void;
};

const THREADS_QUERY_KEY = ['chat-ai-threads'];

function bundleQueryKey(threadId: string): readonly ['chat-ai-thread-bundle', string] {
  return ['chat-ai-thread-bundle', threadId];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sortThreadSummaries(threads: readonly ChatAiThreadSummary[]): ChatAiThreadSummary[] {
  return [...threads].sort((left, right) => {
    const timeDelta = right.updatedAtMs - left.updatedAtMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function upsertThreadSummary(
  threads: readonly ChatAiThreadSummary[],
  nextThread: ChatAiThreadSummary,
): ChatAiThreadSummary[] {
  const filtered = threads.filter((thread) => thread.id !== nextThread.id);
  filtered.push(nextThread);
  return sortThreadSummaries(filtered);
}

function replaceMessage(
  messages: readonly ChatAiMessageRecord[],
  nextMessage: ChatAiMessageRecord,
): ChatAiMessageRecord[] {
  const filtered = messages.filter((message) => message.id !== nextMessage.id);
  filtered.push(nextMessage);
  return [...filtered].sort((left, right) => {
    const timeDelta = left.createdAtMs - right.createdAtMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function upsertBundleDraft(
  bundle: ChatAiThreadBundle | null | undefined,
  draft: ChatAiDraftRecord | null,
): ChatAiThreadBundle | null | undefined {
  if (!bundle) {
    return bundle;
  }
  return {
    ...bundle,
    draft,
  };
}

function createEmptyBundle(thread: ChatAiThreadRecord): ChatAiThreadBundle {
  return {
    thread,
    messages: [],
    draft: null,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || 'Unknown error');
}

function normalizeReasoningText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isEmptyPendingAssistantMessage(message: ReturnType<typeof toConversationMessageViewModel>): boolean {
  if (message.role !== 'assistant' || message.status !== 'pending') {
    return false;
  }
  return !message.text.trim() && !normalizeReasoningText(message.metadata?.reasoningText) && !message.error;
}

function ChatAiRouteRail(input: {
  currentRoute: AiConversationRouteSnapshot | null;
  availableRoutes: readonly AiConversationRouteSnapshot[];
  runtimeConfigState: RuntimeConfigStateV11 | null;
  disabled: boolean;
  onSelectRoute: (route: AiConversationRouteSnapshot) => void;
  currentRouteLabel: string;
  availableRoutesLabel: string;
}) {
  const currentSummary = getAiRouteDisplaySummary(input.currentRoute, input.runtimeConfigState);

  return (
    <div className="space-y-4">
      <CanonicalDrawerSection title={input.currentRouteLabel}>
        <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {currentSummary.label}
        </div>
        <div className="text-xs text-[var(--nimi-text-muted)]">
          {currentSummary.detail}
        </div>
      </CanonicalDrawerSection>
      <CanonicalDrawerSection title={input.availableRoutesLabel}>
        <div className="space-y-2">
          {input.availableRoutes.map((route) => {
            const routeSummary = getAiRouteDisplaySummary(route, input.runtimeConfigState);
            const active = isAiRouteSnapshotEqual(route, input.currentRoute);
            const routeKey = route.routeKind === 'local'
              ? 'local'
              : `${route.connectorId}:${route.modelId || 'missing-model'}`;
            return (
              <button
                key={routeKey}
                type="button"
                disabled={input.disabled}
                onClick={() => input.onSelectRoute(route)}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                  active
                    ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]'
                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] hover:border-[var(--nimi-border-strong)]'
                }`}
              >
                <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {routeSummary.label}
                </div>
                <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  {routeSummary.detail}
                </div>
              </button>
            );
          })}
        </div>
      </CanonicalDrawerSection>
    </div>
  );
}

export function useAiConversationModeHost(
  input: UseAiConversationModeHostInput,
): { host: DesktopConversationModeHost; readiness: AiConversationRouteReadiness } {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const currentDraftTextRef = useRef('');
  const reportHostError = useCallback((error: unknown) => {
    setStatusBanner({
      kind: 'error',
      message: toErrorMessage(error),
    });
  }, [setStatusBanner]);

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

  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;
  // Composer is available whenever setup is ready — don't gate on activeThreadId
  // so that the composer shows before auto-create finishes.
  const composerReady = readiness.setupState.status === 'ready'
    && !isBundleLoading
    && !bundleQuery.error;

  const setThreadsCache = useCallback((updater: (current: ChatAiThreadSummary[]) => ChatAiThreadSummary[]) => {
    queryClient.setQueryData<ChatAiThreadSummary[]>(THREADS_QUERY_KEY, (current) => {
      const safeCurrent = Array.isArray(current) ? current : [];
      return updater(safeCurrent);
    });
  }, [queryClient]);

  const setBundleCache = useCallback((
    threadId: string,
    updater: (current: ChatAiThreadBundle | null | undefined) => ChatAiThreadBundle | null | undefined,
  ) => {
    queryClient.setQueryData<ChatAiThreadBundle | null>(bundleQueryKey(threadId), (current) => updater(current));
  }, [queryClient]);

  const syncSelectionToThread = useCallback((threadId: string | null, routeSnapshot: AiConversationRouteSnapshot | null) => {
    setSelection({ threadId, routeSnapshot });
  }, [setSelection]);

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

  // Auto-create the single AI thread when route is ready and no thread exists.
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
    if (!activeThreadId || !selectedThreadRecord || !currentRouteSnapshot) {
      throw new Error(t('Chat.aiSubmitMissingThread', { defaultValue: 'Select a conversation before sending a message.' }));
    }
    if (readiness.setupState.status !== 'ready') {
      throw new Error(t('Chat.aiSubmitRouteUnavailable', { defaultValue: 'Choose a ready AI route before sending a message.' }));
    }

    const submittedText = text.trim();
    if (!submittedText) {
      return;
    }

    const userMessageId = randomIdV11('ai-message-user');
    const assistantMessageId = randomIdV11('ai-message-assistant');
    const createdAtMs = Date.now();
    const userMessage: ChatAiMessageRecord = {
      id: userMessageId,
      threadId: activeThreadId,
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
      threadId: activeThreadId,
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
    setSubmittingThreadId(activeThreadId);
    let streamedText = '';
    let streamedReasoningText = '';
    let runtimeTraceId: string | null = null;
    let promptTraceId = '';

    try {
      await chatAiStoreClient.deleteDraft(activeThreadId);
      setBundleCache(activeThreadId, (current) => upsertBundleDraft(current, null) || current);

      await chatAiStoreClient.createMessage(userMessage);
      await chatAiStoreClient.createMessage(assistantPlaceholder);
      setBundleCache(activeThreadId, (current) => {
        const base = current || createEmptyBundle({
          ...selectedThreadRecord,
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

      const abortController = startStream(activeThreadId, STREAM_TEXT_TOTAL_TIMEOUT_MS);
      const runtimeResult = await streamChatAiRuntime({
        routeSnapshot: currentRouteSnapshot,
        prompt: submittedText,
        threadId: activeThreadId,
        runtimeConfigState: input.runtimeConfigState,
        runtimeFields: input.runtimeFields,
        signal: abortController.signal,
      });
      promptTraceId = runtimeResult.promptTraceId;
      for await (const part of runtimeResult.stream) {
        if (part.type === 'reasoning-delta') {
          streamedReasoningText += part.text;
          feedStreamEvent(activeThreadId, {
            type: 'reasoning_delta',
            textDelta: part.text,
          });
          continue;
        }
        if (part.type === 'delta') {
          streamedText += part.text;
          feedStreamEvent(activeThreadId, {
            type: 'text_delta',
            textDelta: part.text,
          });
          continue;
        }
        if (part.type === 'finish') {
          runtimeTraceId = String(part.trace.traceId || promptTraceId || '').trim() || null;
          feedStreamEvent(activeThreadId, { type: 'done', usage: part.usage });
          continue;
        }
        if (part.type === 'error') {
          runtimeTraceId = String(part.error.traceId || runtimeTraceId || promptTraceId || '').trim() || null;
          feedStreamEvent(activeThreadId, {
            type: 'error',
            message: part.error.message,
            reasonCode: part.error.reasonCode,
            traceId: runtimeTraceId || undefined,
          });
          throw part.error;
        }
      }

      const completedState = getStreamState(activeThreadId);
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
        id: selectedThreadRecord.id,
        title: resolveThreadTitleAfterFirstSend(selectedThreadRecord.title, submittedText),
        updatedAtMs: Date.now(),
        lastMessageAtMs: assistantMessage.updatedAtMs,
        archivedAtMs: selectedThreadRecord.archivedAtMs,
        routeSnapshot: currentRouteSnapshot,
      });
      setThreadsCache((current) => upsertThreadSummary(current, updatedThread));
      setBundleCache(activeThreadId, (current) => {
        const base = current || createEmptyBundle(updatedThread);
        return {
          ...base,
          thread: updatedThread,
          messages: replaceMessage(base.messages, assistantMessage),
          draft: null,
        };
      });
      currentDraftTextRef.current = '';
      syncSelectionToThread(activeThreadId, updatedThread.routeSnapshot);
    } catch (error) {
      const streamSnapshot = getStreamState(activeThreadId);
      const partialText = streamSnapshot.partialText || streamedText;
      const partialReasoningText = streamSnapshot.partialReasoningText || streamedReasoningText;
      const runtimeError = streamSnapshot.cancelSource === 'user'
        ? {
          code: 'OPERATION_ABORTED',
          message: t('Chat.aiGenerationStopped', { defaultValue: 'Generation stopped.' }),
        }
        : toChatAiRuntimeError(error);
      if (streamSnapshot.phase === 'waiting' || streamSnapshot.phase === 'streaming') {
        feedStreamEvent(activeThreadId, {
          type: 'error',
          message: runtimeError.message,
          reasonCode: runtimeError.code,
          traceId: streamSnapshot.traceId || runtimeTraceId || promptTraceId || undefined,
        });
      }
      const draft = await chatAiStoreClient.putDraft({
        threadId: activeThreadId,
        text: submittedText,
        attachments: [],
        updatedAtMs: Date.now(),
      });
      setBundleCache(activeThreadId, (current) => upsertBundleDraft(current, draft) || current);
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
        setBundleCache(activeThreadId, (current) => {
          const base = current || createEmptyBundle({
            ...selectedThreadRecord,
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
        setBundleCache(activeThreadId, (current) => {
          const base = current || createEmptyBundle({
            ...selectedThreadRecord,
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
    currentRouteSnapshot,
    input.runtimeConfigState,
    input.runtimeFields,
    readiness.setupState.status,
    selectedThreadRecord,
    setBundleCache,
    setThreadsCache,
    syncSelectionToThread,
    t,
  ]);

  const routeSummary = getAiRouteDisplaySummary(currentRouteSnapshot, input.runtimeConfigState);
  const adapter = useMemo(() => ({
    mode: 'ai' as const,
    setupState: readiness.setupState,
    threadAdapter: {
      listThreads: () => threads.map((thread) => toConversationThreadSummary(thread)),
      listMessages: (threadId: string) => (
        bundle && bundle.thread.id === threadId
          ? messages
          : []
      ),
    },
    composerAdapter: composerReady
      ? {
        submit: async (composerInput: ChatComposerSubmitInput<unknown>) => {
          await handleSubmit(composerInput.text);
        },
        disabled: Boolean(submittingThreadId),
        disabledReason: submittingThreadId
          ? t('Chat.aiSending', { defaultValue: 'Generating response…' })
          : null,
        placeholder: t('Chat.aiComposerPlaceholder', { defaultValue: 'Ask anything…' }),
      }
      : null,
  }), [bundle, composerReady, handleSubmit, messages, readiness.setupState, submittingThreadId, t, threads]);

  const aiCharacterData = useMemo(() => ({
    name: t('Chat.aiAssistantName', { defaultValue: 'AI Assistant' }),
    avatarUrl: null,
    avatarFallback: 'AI',
    bio: routeSummary.detail || t('Chat.aiNoBio', { defaultValue: 'Configure a model to start chatting.' }),
    presenceLabel: readiness.localReady
      ? 'Local Ready'
      : readiness.cloudReady
        ? 'Cloud Ready'
        : 'No Route',
    presenceBusy: false,
    theme: {
      roomSurface: 'linear-gradient(180deg, rgba(250,252,252,0.98), rgba(244,247,248,0.96))',
      roomAura: 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(232,245,245,0.78))',
      accentSoft: 'rgba(125,211,252,0.22)',
      accentStrong: '#38bdf8',
      border: 'rgba(56,189,248,0.34)',
      text: '#0c4a6e',
    },
    badges: readiness.localReady
      ? [{ label: 'Local Ready', variant: 'online' as const, pulse: true }]
      : readiness.cloudReady
        ? [{ label: 'Cloud Ready', variant: 'online' as const, pulse: true }]
        : [{ label: 'No Route', variant: 'default' as const }],
  }), [readiness.cloudReady, readiness.localReady, routeSummary.detail, t]);
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
  const canonicalMessages = useMemo(
    () => messages.map((message) => ({
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
      metadata: message.metadata,
    })),
    [activeThreadId, messages],
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

  const host = useMemo<DesktopConversationModeHost>(() => ({
    mode: 'ai',
    availability: {
      mode: 'ai',
      label: 'AI',
      enabled: true,
      badge: threads.length > 0 ? threads.length : null,
      disabledReason: null,
    },
    adapter,
    activeThreadId,
    targets: [syntheticTarget],
    selectedTargetId: 'ai:assistant',
    onSelectTarget: () => undefined,
    messages: canonicalMessages,
    characterData: aiCharacterData,
    settingsContent: <ChatSettingsPanel />,
    settingsDrawerTitle: t('Chat.settingsTitle', { defaultValue: 'Settings' }),
    settingsDrawerSubtitle: t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' }),
    transcriptProps: {
      loading: isBundleLoading,
      error: bundleQuery.error ? toErrorMessage(bundleQuery.error) : null,
      emptyEyebrow: 'AI',
      emptyTitle: t('Chat.aiTranscriptEmptyTitle', { defaultValue: 'Start the AI conversation' }),
      emptyDescription: t('Chat.aiTranscriptEmpty', { defaultValue: 'Send a message to start this conversation.' }),
      loadingLabel: t('Chat.aiTranscriptLoading', { defaultValue: 'Loading conversation…' }),
      footerContent,
      renderMessageContent,
      pendingFirstBeat,
    },
    stagePanelProps: {
      footerContent,
      renderMessageContent,
      pendingFirstBeat,
    },
    composerContent: (
      adapter.composerAdapter ? (
        <CanonicalComposer
          key={`${activeThreadId || 'none'}:${bundle?.draft?.updatedAtMs || 0}`}
          adapter={adapter.composerAdapter}
          initialText={bundle?.draft?.text || ''}
          disabled={Boolean(submittingThreadId)}
          placeholder={t('Chat.aiComposerPlaceholder', { defaultValue: 'Ask anything…' })}
          onInputCaptureText={(text) => {
            currentDraftTextRef.current = text;
          }}
        />
      ) : null
    ),
    profileContent: (
      <ChatAiRouteRail
        currentRoute={currentRouteSnapshot}
        availableRoutes={availableRouteSnapshots}
        runtimeConfigState={input.runtimeConfigState}
        disabled={Boolean(submittingThreadId)}
        onSelectRoute={handleRouteSelection}
        currentRouteLabel={t('Chat.aiCurrentRoute', { defaultValue: 'Current route' })}
        availableRoutesLabel={t('Chat.aiAvailableRoutes', { defaultValue: 'Available routes' })}
      />
    ),
    profileDrawerTitle: t('Chat.aiProfileTitle', { defaultValue: 'Profile' }),
    profileDrawerSubtitle: t('Chat.aiProfileSubtitle', { defaultValue: 'Route, target, and conversation details.' }),
    onSelectThread: handleSelectThread,
    renderEmptyState: () => (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-600/70">
          AI
        </div>
        <p className="max-w-[420px] text-sm text-slate-500">
          {t('Chat.aiTranscriptEmpty', { defaultValue: 'Send a message to start this conversation.' })}
        </p>
      </div>
    ),
    renderSetupDescription: () => (
      readiness.localReady || readiness.cloudReady
        ? t('Chat.aiRouteUnavailable', {
          defaultValue: 'The saved AI route is no longer ready. Pick one of the ready routes on the right to continue.',
        })
        : t('Chat.aiRouteRequired', {
          defaultValue: 'Configure a local chat route or a healthy cloud connector before AI mode can open a conversation.',
        })
    ),
    renderThreadMeta: (thread) => {
      const sourceThread = threads.find((item) => item.id === thread.id) || null;
      const summary = getAiRouteDisplaySummary(sourceThread?.routeSnapshot || null, input.runtimeConfigState);
      return (
        <span className="truncate text-[11px] text-[var(--nimi-text-muted)]">
          {summary.label}
        </span>
      );
    },
  }), [
    activeThreadId,
    adapter,
    availableRouteSnapshots,
    bundle?.draft?.text,
    bundle?.draft?.updatedAtMs,
    bundleQuery.error,
    canonicalMessages,
    currentRouteSnapshot,
    footerContent,
    handleCreateThread,
    handleRouteSelection,
    handleSelectThread,
    handleSubmit,
    input.runtimeConfigState,
    isBundleLoading,
    pendingFirstBeat,
    readiness.cloudReady,
    readiness.localReady,
    readiness.setupState.status,
    renderMessageContent,
    routeSummary.detail,
    routeSummary.label,
    reportHostError,
    submittingThreadId,
    syntheticTarget,
    t,
    threads,
  ]);

  return { host, readiness };
}
