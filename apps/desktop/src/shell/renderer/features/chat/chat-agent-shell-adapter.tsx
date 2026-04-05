import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createReadyConversationSetupState,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  ConversationOrchestrationRegistry,
  matchConversationTurnEvent,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import {
  type AgentLocalMessageRecord,
  type AgentLocalTargetSnapshot,
  type AgentLocalThreadBundle,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import { randomIdV11, type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import {
  findAgentConversationThreadByAgentId,
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
  toConversationMessageViewModel,
} from './chat-agent-thread-model';
import {
  createEmptyAgentThreadBundle,
  resolveAuthoritativeAgentThreadBundle,
} from './chat-agent-shell-bundle';
import {
  assertAgentTurnLifecycleCompleted,
  type AgentTurnLifecycleState,
} from './chat-agent-shell-lifecycle';
import {
  type AgentHostFlowFooterState,
} from './chat-agent-shell-host-flow';
import {
  createInitialAgentSubmitDriverState,
  reduceAgentSubmitDriverEvent,
  resolveCompletedAgentSubmitDriverCheckpoint,
  resolveInterruptedAgentSubmitDriverCheckpoint,
  resolveAgentSubmitDriverProjectionRefresh,
} from './chat-agent-shell-submit-driver';
import {
  resolveAgentLocalRoute,
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import { createAgentLocalChatConversationProvider } from './chat-agent-orchestration';
import { resolveAiConversationRouteReadiness } from './chat-ai-route-readiness';
import type { AgentConversationSelection } from './chat-shell-types';
import {
  createReasoningMessageContentRenderer,
  useConversationStreamState,
} from './chat-runtime-stream-ui';
import {
  getChatThinkingUnsupportedCopy,
  resolveAgentChatThinkingSupport,
} from './chat-thinking';
import {
  getStreamState,
  startStream,
  STREAM_TEXT_TOTAL_TIMEOUT_MS,
} from '../turns/stream-controller';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  bundleQueryKey,
  normalizeText,
  sortThreadSummaries,
  toAbortError,
  toConversationHistoryMessages,
  toErrorMessage,
  toStructuredProviderError,
  THREADS_QUERY_KEY,
  TARGETS_QUERY_KEY,
  upsertBundleDraft,
  upsertThreadSummary,
  isEmptyPendingAssistantMessage,
} from './chat-agent-shell-core';
import { useAgentConversationPresentation } from './chat-agent-shell-presentation';
import { useAgentConversationEffects } from './chat-agent-shell-effects';

type SocialSnapshot = Awaited<ReturnType<typeof dataSync.loadSocialSnapshot>>;

type UseAgentConversationModeHostInput = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AgentConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AgentConversationSelection) => void;
};

export function useAgentConversationModeHost(
  input: UseAgentConversationModeHostInput,
): DesktopConversationModeHost {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const chatThinkingPreference = useAppStore((state) => state.chatThinkingPreference);
  const setChatThinkingPreference = useAppStore((state) => state.setChatThinkingPreference);
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const [footerHostStateByThreadId, setFooterHostStateByThreadId] = useState<
    Record<string, {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    }>
  >({});
  const currentDraftTextRef = useRef('');
  const creatingThreadForAgentIdRef = useRef<string | null>(null);
  const registry = useMemo(() => {
    const nextRegistry = new ConversationOrchestrationRegistry();
    nextRegistry.register(createAgentLocalChatConversationProvider());
    return nextRegistry;
  }, []);
  const agentProvider = useMemo(
    () => registry.require('agent-local-chat-v1'),
    [registry],
  );
  const reportHostError = useCallback((error: unknown) => {
    setHostFeedback({
      kind: 'error',
      message: toErrorMessage(error),
    });
  }, []);
  const thinkingSupport = useMemo(
    () => resolveAgentChatThinkingSupport(),
    [],
  );
  const thinkingUnsupportedReason = useMemo(() => {
    if (thinkingSupport.supported || !thinkingSupport.reason) {
      return null;
    }
    const copy = getChatThinkingUnsupportedCopy(thinkingSupport.reason);
    return t(copy.key, { defaultValue: copy.defaultValue });
  }, [t, thinkingSupport]);

  const setSelection = useCallback((selection: AgentConversationSelection) => {
    if (
      input.selection.threadId === selection.threadId
      && input.selection.agentId === selection.agentId
      && input.selection.targetId === selection.targetId
    ) {
      return;
    }
    input.setSelection(selection);
  }, [input]);

  const targetsQuery = useQuery({
    queryKey: [...TARGETS_QUERY_KEY, input.authStatus],
    queryFn: async (): Promise<AgentLocalTargetSnapshot[]> => {
      const snapshot = await dataSync.loadSocialSnapshot() as SocialSnapshot;
      return toAgentFriendTargetsFromSocialSnapshot(snapshot);
    },
    enabled: input.authStatus === 'authenticated',
  });

  const targets = useMemo(
    () => targetsQuery.data || [],
    [targetsQuery.data],
  );
  const targetByAgentId = useMemo(
    () => new Map(targets.map((target) => [target.agentId, target])),
    [targets],
  );

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => chatAgentStoreClient.listThreads(),
    enabled: input.authStatus === 'authenticated',
  });
  const threads = useMemo(
    () => sortThreadSummaries(threadsQuery.data || []),
    [threadsQuery.data],
  );

  const activeThreadId = useMemo(
    () => resolveAgentConversationActiveThreadId({
      threads,
      selectionThreadId: input.selection.threadId,
      selectionAgentId: input.selection.agentId,
      lastSelectedThreadId: input.lastSelectedThreadId,
    }),
    [input.lastSelectedThreadId, input.selection.agentId, input.selection.threadId, threads],
  );

  const selectedThreadRecord = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads],
  );
  const selectedTarget = useMemo(
    () => targetByAgentId.get(input.selection.agentId || '') || null,
    [input.selection.agentId, targetByAgentId],
  );
  const activeTarget = selectedThreadRecord?.targetSnapshot || selectedTarget || null;

  const agentRouteReadiness = useMemo(
    () => resolveAiConversationRouteReadiness({ runtimeConfigState: input.runtimeConfigState }),
    [input.runtimeConfigState],
  );
  const agentRouteReady = agentRouteReadiness.status === 'ready';

  const bundleQuery = useQuery({
    queryKey: activeThreadId ? bundleQueryKey(activeThreadId) : ['chat-agent-thread-bundle', 'inactive'],
    queryFn: () => chatAgentStoreClient.getThreadBundle(activeThreadId as string),
    enabled: Boolean(activeThreadId),
  });
  const bundle = bundleQuery.data || null;
  const messages = useMemo(
    () => (bundle?.messages || [])
      .map((message: AgentLocalMessageRecord) => toConversationMessageViewModel(message))
      .filter((message) => !isEmptyPendingAssistantMessage(message)),
    [bundle?.messages],
  );
  const streamState = useConversationStreamState(activeThreadId);
  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;

  const setupState = useMemo(() => {
    if (input.authStatus !== 'authenticated') {
      return {
        mode: 'agent' as const,
        status: 'setup-required' as const,
        issues: [{ code: 'agent-contract-unavailable' as const, detail: 'Sign in to use Agent mode' }],
        primaryAction: {
          kind: 'sign-in' as const,
          returnToMode: 'agent' as const,
        },
      };
    }
    if (!activeTarget) {
      return createReadyConversationSetupState('agent');
    }
    if (agentRouteReady) {
      return createReadyConversationSetupState('agent');
    }
    const agentIssues = agentRouteReadiness.setupState.issues;
    const agentAction = agentRouteReadiness.setupState.primaryAction
      ? { ...agentRouteReadiness.setupState.primaryAction, returnToMode: 'agent' as const }
      : {
        kind: 'open-settings' as const,
        targetId: 'runtime-overview' as const,
        returnToMode: 'agent' as const,
      };
    return {
      mode: 'agent' as const,
      status: 'setup-required' as const,
      issues: agentIssues,
      primaryAction: agentAction,
    };
  }, [activeTarget, agentRouteReady, agentRouteReadiness.setupState, input.authStatus]);

  const composerReady = setupState.status === 'ready'
    && !isBundleLoading
    && !bundleQuery.error;

  const {
    applyDriverEffects,
    setBundleCache,
    setFooterHostState,
    setThreadsCache,
    syncSelectionToThread,
  } = useAgentConversationEffects({
    currentDraftTextRef,
    queryClient,
    setFooterHostStateByThreadId,
    setSelection,
  });

  useEffect(() => {
    currentDraftTextRef.current = bundle?.draft?.text || '';
  }, [bundle?.draft?.text, bundle?.draft?.updatedAtMs]);

  const persistDraftForThread = useCallback(async (threadId: string | null) => {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const nextText = currentDraftTextRef.current;
    if (nextText.trim()) {
      const draft = await chatAgentStoreClient.putDraft({
        threadId: normalizedThreadId,
        text: nextText,
        updatedAtMs: Date.now(),
      });
      setBundleCache(
        normalizedThreadId,
        (current: AgentLocalThreadBundle | null | undefined) => upsertBundleDraft(current, draft) || current,
      );
      return;
    }
    await chatAgentStoreClient.deleteDraft(normalizedThreadId);
    setBundleCache(
      normalizedThreadId,
      (current: AgentLocalThreadBundle | null | undefined) => upsertBundleDraft(current, null) || current,
    );
  }, [setBundleCache]);

  const createOrRestoreThreadForTarget = useCallback(async (target: AgentLocalTargetSnapshot) => {
    const existingThread = findAgentConversationThreadByAgentId(threads, target.agentId);
    if (existingThread) {
      syncSelectionToThread(existingThread);
      return existingThread;
    }
    const timestampMs = Date.now();
    try {
      const thread = await chatAgentStoreClient.createThread({
        id: randomIdV11('agent-thread'),
        agentId: target.agentId,
        title: target.displayName,
        createdAtMs: timestampMs,
        updatedAtMs: timestampMs,
        lastMessageAtMs: null,
        archivedAtMs: null,
        targetSnapshot: target,
      });
      setThreadsCache((current) => upsertThreadSummary(current, thread));
      queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyAgentThreadBundle(thread));
      currentDraftTextRef.current = '';
      syncSelectionToThread(thread);
      return thread;
    } catch (error) {
      if (toErrorMessage(error).includes('duplicate primary key or unique value')) {
        const refreshedThreads = await chatAgentStoreClient.listThreads();
        queryClient.setQueryData(THREADS_QUERY_KEY, refreshedThreads);
        const restored = findAgentConversationThreadByAgentId(refreshedThreads, target.agentId);
        if (restored) {
          syncSelectionToThread(restored);
          return restored;
        }
      }
      throw error;
    }
  }, [queryClient, setThreadsCache, syncSelectionToThread, threads]);

  useEffect(() => {
    if (!threadsQuery.isSuccess) {
      return;
    }
    if (input.selection.threadId && !threads.some((thread) => thread.id === input.selection.threadId) && !input.selection.agentId) {
      syncSelectionToThread(null);
      return;
    }
    if (!input.selection.threadId && selectedThreadRecord) {
      syncSelectionToThread(selectedThreadRecord);
    }
  }, [
    input.selection.agentId,
    input.selection.threadId,
    selectedThreadRecord,
    syncSelectionToThread,
    threads,
    threadsQuery.isSuccess,
  ]);

  useEffect(() => {
    if (!targetsQuery.isSuccess || !threadsQuery.isSuccess) {
      return;
    }
    const selectedAgentId = normalizeText(input.selection.agentId);
    if (!selectedAgentId) {
      return;
    }
    const target = targetByAgentId.get(selectedAgentId) || null;
    if (!target) {
      if (!findAgentConversationThreadByAgentId(threads, selectedAgentId)) {
        syncSelectionToThread(null);
      }
      return;
    }
    if (findAgentConversationThreadByAgentId(threads, selectedAgentId)) {
      return;
    }
    if (creatingThreadForAgentIdRef.current === selectedAgentId) {
      return;
    }
    creatingThreadForAgentIdRef.current = selectedAgentId;
    void createOrRestoreThreadForTarget(target)
      .catch(reportHostError)
      .finally(() => {
        if (creatingThreadForAgentIdRef.current === selectedAgentId) {
          creatingThreadForAgentIdRef.current = null;
        }
      });
  }, [
    createOrRestoreThreadForTarget,
    input.selection.agentId,
    reportHostError,
    syncSelectionToThread,
    targetByAgentId,
    targetsQuery.isSuccess,
    threads,
    threadsQuery.isSuccess,
  ]);

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
      syncSelectionToThread(nextThread);
    })().catch(reportHostError);
  }, [activeThreadId, persistDraftForThread, reportHostError, submittingThreadId, syncSelectionToThread, threads]);

  const handleSelectAgent = useCallback((agentId: string | null) => {
    if (submittingThreadId) {
      return;
    }
    void (async () => {
      await persistDraftForThread(activeThreadId);
      currentDraftTextRef.current = '';
      const normalizedAgentId = normalizeText(agentId);
      if (!normalizedAgentId) {
        syncSelectionToThread(null);
        return;
      }
      const target = targetByAgentId.get(normalizedAgentId);
      if (!target) {
        throw new Error(t('Chat.agentTargetMissing', {
          defaultValue: 'The selected agent friend is no longer available.',
        }));
      }
      await createOrRestoreThreadForTarget(target);
    })().catch(reportHostError);
  }, [
    activeThreadId,
    createOrRestoreThreadForTarget,
    persistDraftForThread,
    reportHostError,
    submittingThreadId,
    syncSelectionToThread,
    t,
    targetByAgentId,
  ]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!activeThreadId || !selectedThreadRecord || !activeTarget) {
      throw new Error(t('Chat.agentSubmitMissingThread', {
        defaultValue: 'Select an agent friend before sending a message.',
      }));
    }
    if (!agentRouteReady) {
      throw new Error(t('Chat.agentSubmitRouteUnavailable', {
        defaultValue: 'A local or cloud runtime route is required before sending a message.',
      }));
    }
    const submittedText = text.trim();
    if (!submittedText) {
      return;
    }
    const userTurnId = randomIdV11('agent-turn-user');
    const userMessageId = randomIdV11('agent-message-user');
    const assistantTurnId = randomIdV11('agent-turn');
    const assistantMessageId = `${assistantTurnId}:message:0`;
    const createdAtMs = Date.now();
    const userMessage: AgentLocalMessageRecord = {
      id: userMessageId,
      threadId: activeThreadId,
      role: 'user',
      status: 'complete',
      contentText: submittedText,
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: null,
      createdAtMs,
      updatedAtMs: createdAtMs,
    };
    const assistantPlaceholder: AgentLocalMessageRecord = {
      id: assistantMessageId,
      threadId: activeThreadId,
      role: 'assistant',
      status: 'pending',
      contentText: '',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: userMessageId,
      createdAtMs: createdAtMs + 1,
      updatedAtMs: createdAtMs + 1,
    };

    currentDraftTextRef.current = submittedText;
    setSubmittingThreadId(activeThreadId);
    setFooterHostState(activeThreadId, null);
    let projectionRefreshPromise: Promise<void> | null = null;
    let projectionRefreshError: unknown = null;
    let submitSession = createInitialAgentSubmitDriverState({
      fallbackThread: {
        ...selectedThreadRecord,
        createdAtMs,
      },
      assistantMessageId,
      assistantPlaceholder,
      submittedText,
      workingBundle: bundle,
    });

    try {
      await chatAgentStoreClient.deleteDraft(activeThreadId);
      setBundleCache(activeThreadId, (current) => upsertBundleDraft(current, null) || current);

      const userCommitted = await chatAgentStoreClient.commitTurnResult({
        threadId: activeThreadId,
        turn: {
          id: userTurnId,
          threadId: activeThreadId,
          role: 'user',
          status: 'completed',
          providerMode: 'agent-local-chat-v1',
          traceId: null,
          promptTraceId: null,
          startedAtMs: createdAtMs,
          completedAtMs: createdAtMs,
          abortedAtMs: null,
        },
        beats: [{
          id: `${userTurnId}:beat:0`,
          turnId: userTurnId,
          beatIndex: 0,
          modality: 'text',
          status: 'delivered',
          textShadow: submittedText,
          artifactId: null,
          mimeType: 'text/plain',
          projectionMessageId: userMessageId,
          createdAtMs,
          deliveredAtMs: createdAtMs,
        }],
        interactionSnapshot: null,
        relationMemorySlots: [],
        recallEntries: [],
        projection: {
          thread: {
            id: selectedThreadRecord.id,
            title: selectedThreadRecord.title,
            updatedAtMs: createdAtMs,
            lastMessageAtMs: createdAtMs,
            archivedAtMs: selectedThreadRecord.archivedAtMs,
            targetSnapshot: activeTarget,
          },
          messages: [userMessage],
          draft: null,
          clearDraft: true,
        },
      });
      const userBundle = resolveAuthoritativeAgentThreadBundle({
        optimisticBundle: userCommitted.bundle,
        refreshedBundle: null,
        clearDraft: true,
      });
      if (!userBundle) {
        throw new Error('agent-local-chat-v1 user commit did not return a projection bundle');
      }
      setThreadsCache((current) => upsertThreadSummary(current, userBundle.thread));
      queryClient.setQueryData(bundleQueryKey(activeThreadId), userBundle);
      syncSelectionToThread(userBundle.thread);
      submitSession = createInitialAgentSubmitDriverState({
        fallbackThread: {
          ...selectedThreadRecord,
          createdAtMs,
        },
        assistantMessageId,
        assistantPlaceholder,
        submittedText,
        workingBundle: userBundle,
      });

      const routeResult = await resolveAgentLocalRoute(activeTarget.agentId);
      const abortController = startStream(activeThreadId, STREAM_TEXT_TOTAL_TIMEOUT_MS);
      const history = toConversationHistoryMessages(userBundle.messages);
      for await (const event of agentProvider.runTurn({
        modeId: 'agent-local-chat-v1',
        threadId: activeThreadId,
        turnId: assistantTurnId,
        userMessage: {
          id: userMessageId,
          text: submittedText,
          attachments: [],
        },
        history,
        signal: abortController.signal,
        metadata: {
          agentLocalChat: {
            agentId: activeTarget.agentId,
            targetSnapshot: activeTarget,
            routeResult,
            runtimeConfigState: input.runtimeConfigState,
            runtimeFields: input.runtimeFields,
            reasoningPreference: chatThinkingPreference,
          },
        },
        })) {
        matchConversationTurnEvent(event, {
          'turn-started': () => undefined,
          'reasoning-delta': (nextEvent) => {
            submitSession = applyDriverEffects(activeThreadId, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'text-delta': (nextEvent) => {
            submitSession = applyDriverEffects(activeThreadId, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'first-beat-sealed': (nextEvent) => {
            submitSession = applyDriverEffects(activeThreadId, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'beat-planned': () => undefined,
          'beat-delivery-started': () => undefined,
          'beat-delivered': () => undefined,
          'artifact-ready': () => undefined,
          'projection-rebuilt': (nextEvent) => {
            const projectionEffects = reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            });
            submitSession = applyDriverEffects(activeThreadId, projectionEffects);
            if (!projectionEffects.awaitRefresh) {
              return;
            }
            const requestedProjectionVersion = projectionEffects.awaitRefresh.requestedProjectionVersion;
            projectionRefreshPromise = chatAgentStoreClient.getThreadBundle(activeThreadId)
              .then((refreshedBundle) => {
                submitSession = applyDriverEffects(activeThreadId, resolveAgentSubmitDriverProjectionRefresh({
                  state: submitSession,
                  requestedProjectionVersion,
                  streamSnapshot: getStreamState(activeThreadId),
                  refreshedBundle,
                  draftText: currentDraftTextRef.current,
                }));
              })
              .catch((refreshError) => {
                projectionRefreshError = refreshError;
              });
          },
          'turn-completed': (nextEvent) => {
            submitSession = applyDriverEffects(activeThreadId, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'turn-failed': (nextEvent) => {
            submitSession = applyDriverEffects(activeThreadId, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'turn-canceled': (nextEvent) => {
            submitSession = applyDriverEffects(activeThreadId, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
        });
      }
      if (projectionRefreshPromise) {
        await projectionRefreshPromise;
      }
      if (projectionRefreshError) {
        throw projectionRefreshError;
      }

      const refreshedBundle = submitSession.lifecycle.projectionVersion
        ? await chatAgentStoreClient.getThreadBundle(activeThreadId)
        : null;
      submitSession = applyDriverEffects(activeThreadId, resolveCompletedAgentSubmitDriverCheckpoint({
        state: submitSession,
        refreshedBundle,
        streamSnapshot: getStreamState(activeThreadId),
      }));

      if (submitSession.lifecycle.terminal === 'failed' && submitSession.lifecycle.error) {
        throw toStructuredProviderError(submitSession.lifecycle.error);
      }
      if (submitSession.lifecycle.terminal === 'canceled') {
        throw toAbortError(t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }));
      }
      assertAgentTurnLifecycleCompleted(submitSession.lifecycle);
    } catch (error) {
      const streamSnapshot = getStreamState(activeThreadId);
      const runtimeError = streamSnapshot.cancelSource === 'user'
        ? {
          code: 'OPERATION_ABORTED',
          message: t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }),
        }
        : toChatAgentRuntimeError(error);
      const draftUpdatedAtMs = Date.now();
      const draft = await chatAgentStoreClient.putDraft({
        threadId: activeThreadId,
        text: submittedText,
        updatedAtMs: draftUpdatedAtMs,
      });
      let refreshedBundle: AgentLocalThreadBundle | null = null;
      if (submitSession.lifecycle.projectionVersion) {
        refreshedBundle = await chatAgentStoreClient.getThreadBundle(activeThreadId);
      }
      submitSession = applyDriverEffects(activeThreadId, resolveInterruptedAgentSubmitDriverCheckpoint({
        state: submitSession,
        refreshedBundle,
        runtimeError,
        draft,
        updatedAtMs: draftUpdatedAtMs,
        streamSnapshot,
      }));
      throw new Error(runtimeError.message, {
        cause: error,
      });
    } finally {
      setSubmittingThreadId(null);
    }
  }, [
    activeTarget,
    activeThreadId,
    agentProvider,
    chatThinkingPreference,
    agentRouteReady,
    applyDriverEffects,
    input.runtimeConfigState,
    input.runtimeFields,
    queryClient,
    selectedThreadRecord,
    setBundleCache,
    setFooterHostState,
    setThreadsCache,
    syncSelectionToThread,
    t,
  ]);

  const reasoningLabel = t('Chat.reasoningLabel', { defaultValue: 'Thought process' });
  const renderMessageContent = useMemo(
    () => createReasoningMessageContentRenderer(reasoningLabel),
    [reasoningLabel],
  );
  const currentFooterHostState = activeThreadId ? footerHostStateByThreadId[activeThreadId] || null : null;
  const presentation = useAgentConversationPresentation({
    activeTarget,
    activeThreadId,
    bundle,
    bundleError: bundleQuery.error,
    composerReady,
    currentDraftTextRef,
    currentFooterHostState,
    handleSubmit,
    hostFeedback,
    inputSelectionAgentId: input.selection.agentId,
    isBundleLoading,
    messages,
    onDismissHostFeedback: () => setHostFeedback(null),
    reasoningLabel,
    renderMessageContent,
    selectedTargetId: activeTarget?.agentId || null,
    setChatThinkingPreference,
    setupState,
    streamState,
    submittingThreadId,
    t,
    targetSummariesInput: { targets, threads },
    targetsPending: targetsQuery.isPending,
    thinkingPreference: chatThinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    agentRouteReady,
  });

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    onSelectTarget: handleSelectAgent,
    onSelectThread: handleSelectThread,
  }), [handleSelectAgent, handleSelectThread, presentation]);
}
