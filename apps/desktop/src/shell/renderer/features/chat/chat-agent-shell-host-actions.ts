import { useCallback, useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  matchConversationTurnEvent,
  type ConversationTurnEvent,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  type AgentLocalMessageRecord,
  type AgentLocalTargetSnapshot,
  type AgentLocalThreadBundle,
  type AgentLocalThreadRecord,
  type AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  assertAgentTurnLifecycleCompleted,
  type AgentTurnLifecycleState,
} from './chat-agent-shell-lifecycle';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import {
  createInitialAgentSubmitDriverState,
  reduceAgentSubmitDriverEvent,
  resolveCompletedAgentSubmitDriverCheckpoint,
  resolveInterruptedAgentSubmitDriverCheckpoint,
  resolveAgentSubmitDriverProjectionRefresh,
  type AgentSubmitDriverState,
} from './chat-agent-shell-submit-driver';
import {
  findAgentConversationThreadByAgentId,
} from './chat-agent-thread-model';
import {
  createEmptyAgentThreadBundle,
  resolveAuthoritativeAgentThreadBundle,
} from './chat-agent-shell-bundle';
import {
  toChatAgentRuntimeError,
  type AgentChatRouteResult,
} from './chat-agent-runtime';
import {
  createAISnapshot,
  type AgentEffectiveCapabilityResolution,
  type AIConfig,
  type AISnapshot,
} from './conversation-capability';
import { probeExecutionSchedulingGuard } from './chat-execution-scheduling-guard';
import {
  peekDesktopAISchedulingForEvidence,
  recordDesktopAISnapshot,
  resolveAIConfigSchedulingTargetForCapability,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  bundleQueryKey,
  normalizeText,
  THREADS_QUERY_KEY,
  toAbortError,
  toConversationHistoryMessages,
  toErrorMessage,
  toStructuredProviderError,
  upsertBundleDraft,
  upsertThreadSummary,
} from './chat-agent-shell-core';
import {
  getStreamState,
  startStream,
  STREAM_TEXT_TOTAL_TIMEOUT_MS,
} from '../turns/stream-controller';

type AgentRunTurn = (input: {
  threadId: string;
  turnId: string;
  userMessage: {
    id: string;
    text: string;
    attachments: unknown[];
  };
  history: ReturnType<typeof toConversationHistoryMessages>;
  signal: AbortSignal;
  routeResult: AgentChatRouteResult | null;
  agentResolution: AgentEffectiveCapabilityResolution;
  executionSnapshot: AISnapshot;
  target: AgentLocalTargetSnapshot;
}) => AsyncIterable<ConversationTurnEvent>;

type UseAgentConversationHostActionsInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  aiConfig: AIConfig;
  applyDriverEffects: (threadId: string, effects: ReturnType<typeof reduceAgentSubmitDriverEvent>) => AgentSubmitDriverState;
  bundle: AgentLocalThreadBundle | null;
  currentDraftTextRef: { current: string };
  draftText: string | null | undefined;
  draftUpdatedAtMs: number | null | undefined;
  queryClient: QueryClient;
  reportHostError: (error: unknown) => void;
  runAgentTurn: AgentRunTurn;
  selectedAgentId: string | null;
  selectedThreadRecord: AgentLocalThreadSummary | null;
  setBundleCache: (
    threadId: string,
    updater: (current: AgentLocalThreadBundle | null | undefined) => AgentLocalThreadBundle | null | undefined,
  ) => void;
  setFooterHostState: (
    threadId: string,
    nextState: {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    } | null,
  ) => void;
  setSubmittingThreadId: (threadId: string | null) => void;
  setThreadsCache: (updater: (current: AgentLocalThreadSummary[]) => AgentLocalThreadSummary[]) => void;
  submittingThreadId: string | null;
  syncSelectionToThread: (thread: AgentLocalThreadSummary | AgentLocalThreadRecord | null) => void;
  t: TFunction;
  targetByAgentId: Map<string, AgentLocalTargetSnapshot>;
  targetsReady: boolean;
  threads: readonly AgentLocalThreadSummary[];
  threadsReady: boolean;
};

export async function assertAgentSubmitSchedulingAllowed(input: {
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

export function useAgentConversationHostActions(
  input: UseAgentConversationHostActionsInput,
): {
  handleSelectAgent: (agentId: string | null) => void;
  handleSelectThread: (threadId: string) => void;
  handleSubmit: (text: string) => Promise<void>;
} {
  useEffect(() => {
    input.currentDraftTextRef.current = input.draftText || '';
  }, [input.currentDraftTextRef, input.draftText, input.draftUpdatedAtMs]);

  const persistDraftForThread = useCallback(async (threadId: string | null) => {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const nextText = input.currentDraftTextRef.current;
    if (nextText.trim()) {
      const draft = await chatAgentStoreClient.putDraft({
        threadId: normalizedThreadId,
        text: nextText,
        updatedAtMs: Date.now(),
      });
      input.setBundleCache(
        normalizedThreadId,
        (current) => upsertBundleDraft(current, draft) || current,
      );
      return;
    }
    await chatAgentStoreClient.deleteDraft(normalizedThreadId);
    input.setBundleCache(
      normalizedThreadId,
      (current) => upsertBundleDraft(current, null) || current,
    );
  }, [input]);

  const createOrRestoreThreadForTarget = useCallback(async (target: AgentLocalTargetSnapshot) => {
    const existingThread = findAgentConversationThreadByAgentId(input.threads, target.agentId);
    if (existingThread) {
      input.syncSelectionToThread(existingThread);
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
      input.setThreadsCache((current) => upsertThreadSummary(current, thread));
      input.queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyAgentThreadBundle(thread));
      input.currentDraftTextRef.current = '';
      input.syncSelectionToThread(thread);
      return thread;
    } catch (error) {
      if (toErrorMessage(error).includes('duplicate primary key or unique value')) {
        const refreshedThreads = await chatAgentStoreClient.listThreads();
        input.queryClient.setQueryData(THREADS_QUERY_KEY, refreshedThreads);
        const restored = findAgentConversationThreadByAgentId(refreshedThreads, target.agentId);
        if (restored) {
          input.syncSelectionToThread(restored);
          return restored;
        }
      }
      throw error;
    }
  }, [input]);

  useEffect(() => {
    if (!input.threadsReady) {
      return;
    }
    if (input.activeThreadId && !input.threads.some((thread) => thread.id === input.activeThreadId) && !input.selectedAgentId) {
      input.syncSelectionToThread(null);
      return;
    }
    if (!input.activeThreadId && input.selectedThreadRecord) {
      input.syncSelectionToThread(input.selectedThreadRecord);
    }
  }, [input]);

  const creatingThreadForAgentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!input.targetsReady || !input.threadsReady) {
      return;
    }
    const normalizedAgentId = normalizeText(input.selectedAgentId);
    if (!normalizedAgentId) {
      return;
    }
    const target = input.targetByAgentId.get(normalizedAgentId) || null;
    if (!target) {
      if (!findAgentConversationThreadByAgentId(input.threads, normalizedAgentId)) {
        input.syncSelectionToThread(null);
      }
      return;
    }
    if (findAgentConversationThreadByAgentId(input.threads, normalizedAgentId)) {
      return;
    }
    if (creatingThreadForAgentIdRef.current === normalizedAgentId) {
      return;
    }
    creatingThreadForAgentIdRef.current = normalizedAgentId;
    void createOrRestoreThreadForTarget(target)
      .catch(input.reportHostError)
      .finally(() => {
        if (creatingThreadForAgentIdRef.current === normalizedAgentId) {
          creatingThreadForAgentIdRef.current = null;
        }
      });
  }, [createOrRestoreThreadForTarget, input]);

  const handleSelectThread = useCallback((threadId: string) => {
    if (!threadId || threadId === input.activeThreadId || input.submittingThreadId) {
      return;
    }
    const nextThread = input.threads.find((thread) => thread.id === threadId) || null;
    if (!nextThread) {
      return;
    }
    void (async () => {
      await persistDraftForThread(input.activeThreadId);
      input.currentDraftTextRef.current = '';
      input.syncSelectionToThread(nextThread);
    })().catch(input.reportHostError);
  }, [input, persistDraftForThread]);

  const handleSelectAgent = useCallback((agentId: string | null) => {
    if (input.submittingThreadId) {
      return;
    }
    void (async () => {
      await persistDraftForThread(input.activeThreadId);
      input.currentDraftTextRef.current = '';
      const normalizedAgentId = normalizeText(agentId);
      if (!normalizedAgentId) {
        input.syncSelectionToThread(null);
        return;
      }
      const target = input.targetByAgentId.get(normalizedAgentId);
      if (!target) {
        throw new Error(input.t('Chat.agentTargetMissing', {
          defaultValue: 'The selected agent friend is no longer available.',
        }));
      }
      await createOrRestoreThreadForTarget(target);
    })().catch(input.reportHostError);
  }, [createOrRestoreThreadForTarget, input, persistDraftForThread]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!input.activeThreadId || !input.selectedThreadRecord || !input.activeTarget) {
      throw new Error(input.t('Chat.agentSubmitMissingThread', {
        defaultValue: 'Select an agent friend before sending a message.',
      }));
    }
    if (!input.agentResolution || !input.agentResolution.ready) {
      const resolutionReason = input.agentResolution?.reason || 'projection_unavailable';
      throw new Error(input.t('Chat.agentSubmitRouteUnavailable', {
        defaultValue: `Agent capability resolution not ready: ${resolutionReason}`,
      }));
    }
    const submittedText = text.trim();
    if (!submittedText) {
      return;
    }
    await assertAgentSubmitSchedulingAllowed({
      aiConfig: input.aiConfig,
      t: input.t,
    });
    const userTurnId = randomIdV11('agent-turn-user');
    const userMessageId = randomIdV11('agent-message-user');
    const assistantTurnId = randomIdV11('agent-turn');
    const assistantMessageId = `${assistantTurnId}:message:0`;
    const createdAtMs = Date.now();
    const userMessage: AgentLocalMessageRecord = {
      id: userMessageId,
      threadId: input.activeThreadId,
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
      threadId: input.activeThreadId,
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

    input.currentDraftTextRef.current = submittedText;
    input.setSubmittingThreadId(input.activeThreadId);
    input.setFooterHostState(input.activeThreadId, null);
    let projectionRefreshPromise: Promise<void> | null = null;
    let projectionRefreshError: unknown = null;
    let submitSession = createInitialAgentSubmitDriverState({
      fallbackThread: {
        ...input.selectedThreadRecord,
        createdAtMs,
      },
      assistantMessageId,
      assistantPlaceholder,
      submittedText,
      workingBundle: input.bundle,
    });

    try {
      await chatAgentStoreClient.deleteDraft(input.activeThreadId);
      input.setBundleCache(input.activeThreadId, (current) => upsertBundleDraft(current, null) || current);

      const userCommitted = await chatAgentStoreClient.commitTurnResult({
        threadId: input.activeThreadId,
        turn: {
          id: userTurnId,
          threadId: input.activeThreadId,
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
            id: input.selectedThreadRecord.id,
            title: input.selectedThreadRecord.title,
            updatedAtMs: createdAtMs,
            lastMessageAtMs: createdAtMs,
            archivedAtMs: input.selectedThreadRecord.archivedAtMs,
            targetSnapshot: input.activeTarget,
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
      input.setThreadsCache((current) => upsertThreadSummary(current, userBundle.thread));
      input.queryClient.setQueryData(bundleQueryKey(input.activeThreadId), userBundle);
      input.syncSelectionToThread(userBundle.thread);
      submitSession = createInitialAgentSubmitDriverState({
        fallbackThread: {
          ...input.selectedThreadRecord,
          createdAtMs,
        },
        assistantMessageId,
        assistantPlaceholder,
        submittedText,
        workingBundle: userBundle,
      });

      const eligibility = input.agentResolution!.eligibility;
      const routeResult: AgentChatRouteResult | null = eligibility
        ? {
          channel: eligibility.channel!,
          sessionClass: eligibility.sessionClass!,
          providerSelectable: eligibility.providerSelectable,
          reason: eligibility.reason,
        }
        : null;
      // K-AIEXEC-003: capture scheduling evidence before execution.
      const runtimeEvidence = await peekDesktopAISchedulingForEvidence({
        scopeRef: input.aiConfig.scopeRef,
        target: resolveAIConfigSchedulingTargetForCapability(input.aiConfig, 'text.generate'),
      });
      const executionSnapshot = createAISnapshot({
        config: input.aiConfig,
        capability: 'text.generate',
        projection: input.agentResolution.textProjection!,
        agentResolution: input.agentResolution,
        runtimeEvidence,
      });
      recordDesktopAISnapshot(executionSnapshot);
      const abortController = startStream(input.activeThreadId, STREAM_TEXT_TOTAL_TIMEOUT_MS);
      const history = toConversationHistoryMessages(userBundle.messages);
      for await (const event of input.runAgentTurn({
        threadId: input.activeThreadId,
        turnId: assistantTurnId,
        userMessage: {
          id: userMessageId,
          text: submittedText,
          attachments: [],
        },
        history,
        signal: abortController.signal,
        routeResult,
        agentResolution: input.agentResolution,
        executionSnapshot,
        target: input.activeTarget,
      })) {
        matchConversationTurnEvent(event, {
          'turn-started': () => undefined,
          'reasoning-delta': (nextEvent) => {
            submitSession = input.applyDriverEffects(input.activeThreadId!, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'text-delta': (nextEvent) => {
            submitSession = input.applyDriverEffects(input.activeThreadId!, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'first-beat-sealed': (nextEvent) => {
            submitSession = input.applyDriverEffects(input.activeThreadId!, reduceAgentSubmitDriverEvent({
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
            submitSession = input.applyDriverEffects(input.activeThreadId!, projectionEffects);
            if (!projectionEffects.awaitRefresh) {
              return;
            }
            const requestedProjectionVersion = projectionEffects.awaitRefresh.requestedProjectionVersion;
            projectionRefreshPromise = chatAgentStoreClient.getThreadBundle(input.activeThreadId!)
              .then((refreshedBundle) => {
                submitSession = input.applyDriverEffects(input.activeThreadId!, resolveAgentSubmitDriverProjectionRefresh({
                  state: submitSession,
                  requestedProjectionVersion,
                  streamSnapshot: getStreamState(input.activeThreadId!),
                  refreshedBundle,
                  draftText: input.currentDraftTextRef.current,
                }));
              })
              .catch((refreshError) => {
                projectionRefreshError = refreshError;
              });
          },
          'turn-completed': (nextEvent) => {
            submitSession = input.applyDriverEffects(input.activeThreadId!, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'turn-failed': (nextEvent) => {
            submitSession = input.applyDriverEffects(input.activeThreadId!, reduceAgentSubmitDriverEvent({
              state: submitSession,
              event: nextEvent,
              updatedAtMs: Date.now(),
            }));
          },
          'turn-canceled': (nextEvent) => {
            submitSession = input.applyDriverEffects(input.activeThreadId!, reduceAgentSubmitDriverEvent({
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
        ? await chatAgentStoreClient.getThreadBundle(input.activeThreadId)
        : null;
      submitSession = input.applyDriverEffects(input.activeThreadId, resolveCompletedAgentSubmitDriverCheckpoint({
        state: submitSession,
        refreshedBundle,
        streamSnapshot: getStreamState(input.activeThreadId),
      }));

      if (submitSession.lifecycle.terminal === 'failed' && submitSession.lifecycle.error) {
        throw toStructuredProviderError(submitSession.lifecycle.error);
      }
      if (submitSession.lifecycle.terminal === 'canceled') {
        throw toAbortError(input.t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }));
      }
      assertAgentTurnLifecycleCompleted(submitSession.lifecycle);
    } catch (error) {
      const streamSnapshot = getStreamState(input.activeThreadId);
      const runtimeError = streamSnapshot.cancelSource === 'user'
        ? {
          code: 'OPERATION_ABORTED',
          message: input.t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }),
        }
        : toChatAgentRuntimeError(error);
      const draftUpdatedAtMs = Date.now();
      const draft = await chatAgentStoreClient.putDraft({
        threadId: input.activeThreadId,
        text: submittedText,
        updatedAtMs: draftUpdatedAtMs,
      });
      let refreshedBundle: AgentLocalThreadBundle | null = null;
      if (submitSession.lifecycle.projectionVersion) {
        refreshedBundle = await chatAgentStoreClient.getThreadBundle(input.activeThreadId);
      }
      submitSession = input.applyDriverEffects(input.activeThreadId, resolveInterruptedAgentSubmitDriverCheckpoint({
        state: submitSession,
        refreshedBundle,
        runtimeError,
        draft,
        updatedAtMs: draftUpdatedAtMs,
        streamSnapshot,
      }));
      throw new Error(runtimeError.message, { cause: error });
    } finally {
      input.setSubmittingThreadId(null);
    }
  }, [input]);

  return {
    handleSelectAgent,
    handleSelectThread,
    handleSubmit,
  };
}
