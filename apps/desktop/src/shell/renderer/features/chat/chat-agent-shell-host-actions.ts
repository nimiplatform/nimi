import { useCallback, useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { dataSync } from '@runtime/data-sync';
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
  type ChatAgentVoiceWorkflowReferenceAudio,
} from './chat-agent-runtime';
import {
  AGENT_VOICE_WORKFLOW_CAPABILITIES,
  type AgentVoiceWorkflowCapability,
  createAISnapshot,
  type AgentEffectiveCapabilityResolution,
  type AIConfig,
  type AISnapshot,
} from './conversation-capability';
import {
  refreshAgentEffectiveCapabilityResolution,
  refreshConversationCapabilityProjections,
} from './conversation-capability-projection';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
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
} from '../turns/stream-controller';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { resolveAgentTurnTotalTimeoutMs } from './chat-agent-timeouts';
import { ensureAgentConversationSubmitRouteReady } from './conversation-submit-readiness';
import type { AgentChatUserAttachment } from './chat-ai-execution-engine';
import { buildAgentUserProjectionCommit } from './chat-agent-user-projection';

type AgentRunTurn = (input: {
  threadId: string;
  turnId: string;
  userMessage: {
    id: string;
    text: string;
    attachments: readonly AgentChatUserAttachment[];
  };
  history: ReturnType<typeof toConversationHistoryMessages>;
  signal: AbortSignal;
  agentResolution: AgentEffectiveCapabilityResolution;
  textExecutionSnapshot: AISnapshot;
  imageExecutionSnapshot: AISnapshot | null;
  voiceExecutionSnapshot: AISnapshot | null;
  voiceWorkflowExecutionSnapshotByCapability: Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>>;
  latestVoiceCapture: ChatAgentVoiceWorkflowReferenceAudio | null;
  target: AgentLocalTargetSnapshot;
}) => AsyncIterable<ConversationTurnEvent>;

type UseAgentConversationHostActionsInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
  aiConfig: AIConfig;
  applyDriverEffects: (threadId: string, effects: ReturnType<typeof reduceAgentSubmitDriverEvent>) => AgentSubmitDriverState;
  bundle: AgentLocalThreadBundle | null;
  currentDraftTextRef: { current: string };
  draftText: string | null | undefined;
  draftUpdatedAtMs: number | null | undefined;
  latestVoiceCaptureByThreadRef: {
    current: Record<string, ChatAgentVoiceWorkflowReferenceAudio | undefined>;
  };
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

type ActiveAgentSubmit = {
  threadId: string;
  turnId: string;
  interruptible: boolean;
  overrideRequested: boolean;
  abort: () => void;
  promise: Promise<void>;
};

function isAbortLikeSubmitError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes('aborted')
    || message.includes('cancelled')
    || message.includes('canceled')
    || message.includes('generation stopped');
}

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
  handleSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
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
  const activeSubmitRef = useRef<ActiveAgentSubmit | null>(null);
  const submittingLockTokenRef = useRef(0);
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

  const uploadPendingAttachment = useCallback(async (attachment: PendingAttachment): Promise<AgentChatUserAttachment> => {
    if (attachment.kind !== 'image') {
      throw new Error(input.t('Chat.agentAttachmentImageOnly', {
        defaultValue: 'Agent chat currently supports image attachments only.',
      }));
    }
    const upload = await dataSync.createImageDirectUpload();
    const formData = new FormData();
    formData.append('file', attachment.file);
    let response = await fetch(upload.uploadUrl, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      response = await fetch(upload.uploadUrl, {
        method: 'PUT',
        body: attachment.file,
        headers: {
          'Content-Type': attachment.file.type,
        },
      });
    }
    if (!response.ok) {
      throw new Error(input.t('Chat.agentAttachmentUploadFailed', {
        defaultValue: 'Failed to upload image attachment.',
      }));
    }
    const finalized = await dataSync.finalizeResource(upload.resourceId, {});
    const url = normalizeText(finalized.url);
    if (!url) {
      throw new Error(input.t('Chat.agentAttachmentUploadFailed', {
        defaultValue: 'Failed to upload image attachment.',
      }));
    }
    return {
      kind: 'image',
      url,
      mimeType: normalizeText(finalized.mimeType) || attachment.file.type || null,
      name: attachment.name,
      resourceId: normalizeText(finalized.id) || normalizeText(upload.resourceId) || null,
    };
  }, [input]);

  const handleSubmit = useCallback(async (payload: { text: string; attachments: readonly PendingAttachment[] }) => {
    try {
      const activeTarget = input.activeTarget;
      if (!activeTarget) {
        throw new Error(input.t('Chat.agentSubmitMissingThread', {
          defaultValue: 'Select an agent friend before sending a message.',
        }));
      }
      const submittedText = payload.text.trim();
      if (!submittedText && payload.attachments.length === 0) {
        return;
      }
      const refreshedAgentResolution = await ensureAgentConversationSubmitRouteReady({
        t: input.t,
      });
      await assertAgentSubmitSchedulingAllowed({
        aiConfig: input.aiConfig,
        t: input.t,
      });

      let effectiveThreadRecord: AgentLocalThreadSummary | AgentLocalThreadRecord | null = input.selectedThreadRecord;
      let effectiveThreadId = input.activeThreadId;
      if (!effectiveThreadId || !effectiveThreadRecord) {
        effectiveThreadRecord = await createOrRestoreThreadForTarget(activeTarget);
        effectiveThreadId = effectiveThreadRecord.id;
      }

      const existingSubmit = activeSubmitRef.current;
      if (
        existingSubmit
        && existingSubmit.threadId === effectiveThreadId
        && existingSubmit.interruptible
      ) {
        existingSubmit.overrideRequested = true;
        existingSubmit.abort();
        try {
          await existingSubmit.promise;
        } catch (error) {
          if (!isAbortLikeSubmitError(error)) {
            throw error;
          }
        }
      }

      const userTurnId = randomIdV11('agent-turn-user');
      const assistantTurnId = randomIdV11('agent-turn');
      const assistantMessageId = `${assistantTurnId}:message:0`;
      const createdAtMs = Date.now();
      const uploadedAttachments = payload.attachments.length > 0
        ? await Promise.all(payload.attachments.map((attachment) => uploadPendingAttachment(attachment)))
        : [];
      const userProjection = buildAgentUserProjectionCommit({
        threadId: effectiveThreadId,
        turnId: userTurnId,
        submittedText,
        uploadedAttachments,
        createdAtMs,
      });
      const assistantPlaceholder: AgentLocalMessageRecord = {
        id: assistantMessageId,
        threadId: effectiveThreadId,
        role: 'assistant',
        status: 'pending',
        kind: 'text',
        contentText: '',
        reasoningText: null,
        error: null,
        traceId: null,
        parentMessageId: userProjection.lastMessageId,
        mediaUrl: null,
        mediaMimeType: null,
        artifactId: null,
        metadataJson: null,
        createdAtMs: userProjection.lastMessageAtMs + 1,
        updatedAtMs: userProjection.lastMessageAtMs + 1,
      };

      input.currentDraftTextRef.current = submittedText;
      const latestVoiceCapture = input.latestVoiceCaptureByThreadRef.current[effectiveThreadId] || null;
      const matchedVoiceCapture = latestVoiceCapture?.transcriptText === submittedText
        ? latestVoiceCapture
        : null;
      const submittingLockToken = submittingLockTokenRef.current + 1;
      submittingLockTokenRef.current = submittingLockToken;
      input.setSubmittingThreadId(effectiveThreadId);
      input.setFooterHostState(effectiveThreadId, null);
      let projectionRefreshPromise: Promise<void> | null = null;
      let projectionRefreshError: unknown = null;
      let submitSession = createInitialAgentSubmitDriverState({
        fallbackThread: {
          ...effectiveThreadRecord,
          createdAtMs,
        },
        assistantMessageId,
        assistantPlaceholder,
        submittedText,
        workingBundle: input.bundle,
      });

      await chatAgentStoreClient.deleteDraft(effectiveThreadId);
      input.setBundleCache(effectiveThreadId, (current) => upsertBundleDraft(current, null) || current);

      const userCommitted = await chatAgentStoreClient.commitTurnResult({
        threadId: effectiveThreadId,
        turn: {
          id: userTurnId,
          threadId: effectiveThreadId,
          role: 'user',
          status: 'completed',
          providerMode: 'agent-local-chat-v1',
          traceId: null,
          promptTraceId: null,
          startedAtMs: createdAtMs,
          completedAtMs: createdAtMs,
          abortedAtMs: null,
        },
        beats: [
          ...userProjection.beats,
        ],
        interactionSnapshot: null,
        relationMemorySlots: [],
        recallEntries: [],
        projection: {
          thread: {
            id: effectiveThreadRecord.id,
            title: effectiveThreadRecord.title,
            updatedAtMs: createdAtMs,
            lastMessageAtMs: userProjection.lastMessageAtMs,
            archivedAtMs: effectiveThreadRecord.archivedAtMs,
            targetSnapshot: activeTarget,
          },
          messages: userProjection.messages,
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
      input.queryClient.setQueryData(bundleQueryKey(effectiveThreadId), userBundle);
      input.syncSelectionToThread(userBundle.thread);
      submitSession = createInitialAgentSubmitDriverState({
        fallbackThread: {
          ...effectiveThreadRecord,
          createdAtMs,
        },
        assistantMessageId,
        assistantPlaceholder,
        submittedText,
        workingBundle: userBundle,
      });

      // K-AIEXEC-003: capture scheduling evidence before execution.
      const runtimeEvidence = await peekDesktopAISchedulingForEvidence({
        scopeRef: input.aiConfig.scopeRef,
        target: resolveAIConfigSchedulingTargetForCapability(input.aiConfig, 'text.generate'),
      });
      const textExecutionSnapshot = createAISnapshot({
        config: input.aiConfig,
        capability: 'text.generate',
        projection: refreshedAgentResolution.textProjection!,
        agentResolution: refreshedAgentResolution,
        runtimeEvidence,
      });
      recordDesktopAISnapshot(textExecutionSnapshot);

      // On-demand image projection refresh: if a binding exists but the
      // projection is stale (not supported), re-evaluate before the turn so
      // that a runtime that became ready after bootstrap is picked up.
      let effectiveAgentResolution = refreshedAgentResolution;
      const staleCapabilities: Array<'image.generate' | 'audio.synthesize'> = [];
      if (effectiveAgentResolution.imageProjection?.selectedBinding && !effectiveAgentResolution.imageReady) {
        staleCapabilities.push('image.generate');
      }
      if (effectiveAgentResolution.voiceProjection?.selectedBinding && !effectiveAgentResolution.voiceReady) {
        staleCapabilities.push('audio.synthesize');
      }
      if (staleCapabilities.length > 0) {
        await refreshConversationCapabilityProjections(staleCapabilities);
        refreshAgentEffectiveCapabilityResolution();
        effectiveAgentResolution = useAppStore.getState().agentEffectiveCapabilityResolution
          || effectiveAgentResolution;
      }

      const imageExecutionSnapshot = effectiveAgentResolution.imageProjection?.supported
        && effectiveAgentResolution.imageProjection?.resolvedBinding
        ? createAISnapshot({
          config: input.aiConfig,
          capability: 'image.generate',
          projection: effectiveAgentResolution.imageProjection,
          agentResolution: effectiveAgentResolution,
          runtimeEvidence: await peekDesktopAISchedulingForEvidence({
            scopeRef: input.aiConfig.scopeRef,
            target: resolveAIConfigSchedulingTargetForCapability(input.aiConfig, 'image.generate'),
          }),
        })
        : null;
      if (imageExecutionSnapshot) {
        recordDesktopAISnapshot(imageExecutionSnapshot);
      }
      const voiceExecutionSnapshot = effectiveAgentResolution.voiceProjection?.supported
        && effectiveAgentResolution.voiceProjection?.resolvedBinding
        ? createAISnapshot({
          config: input.aiConfig,
          capability: 'audio.synthesize',
          projection: effectiveAgentResolution.voiceProjection,
          agentResolution: effectiveAgentResolution,
          runtimeEvidence: await peekDesktopAISchedulingForEvidence({
            scopeRef: input.aiConfig.scopeRef,
            target: resolveAIConfigSchedulingTargetForCapability(input.aiConfig, 'audio.synthesize'),
          }),
        })
        : null;
      if (voiceExecutionSnapshot) {
        recordDesktopAISnapshot(voiceExecutionSnapshot);
      }
      const voiceWorkflowExecutionSnapshotByCapability: Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>> = {};
      for (const workflowCapability of AGENT_VOICE_WORKFLOW_CAPABILITIES) {
        const workflowProjection = effectiveAgentResolution.voiceWorkflowProjections[workflowCapability] || null;
        if (!workflowProjection?.supported || !workflowProjection.resolvedBinding) {
          continue;
        }
        const workflowExecutionSnapshot = createAISnapshot({
          config: input.aiConfig,
          capability: workflowCapability,
          projection: workflowProjection,
          agentResolution: effectiveAgentResolution,
          runtimeEvidence: await peekDesktopAISchedulingForEvidence({
            scopeRef: input.aiConfig.scopeRef,
            target: resolveAIConfigSchedulingTargetForCapability(input.aiConfig, workflowCapability),
          }),
        });
        voiceWorkflowExecutionSnapshotByCapability[workflowCapability] = workflowExecutionSnapshot;
        recordDesktopAISnapshot(workflowExecutionSnapshot);
      }
      const abortController = startStream(
        effectiveThreadId,
        resolveAgentTurnTotalTimeoutMs(input.aiConfig),
      );
      let delayedTailPending = false;
      let submittingReleasedForPendingTail = false;
      const activeSubmit: ActiveAgentSubmit = {
        threadId: effectiveThreadId,
        turnId: assistantTurnId,
        interruptible: false,
        overrideRequested: false,
        abort: () => abortController.abort(),
        promise: Promise.resolve(),
      };
      activeSubmitRef.current = activeSubmit;
      const history = toConversationHistoryMessages(userBundle.messages);
      const submitRunPromise = (async () => {
        for await (const event of input.runAgentTurn({
          threadId: effectiveThreadId,
          turnId: assistantTurnId,
          userMessage: {
            id: userProjection.firstMessageId,
            text: submittedText,
            attachments: uploadedAttachments,
          },
          history,
          signal: abortController.signal,
          agentResolution: effectiveAgentResolution,
          textExecutionSnapshot,
          imageExecutionSnapshot,
          voiceExecutionSnapshot,
          voiceWorkflowExecutionSnapshotByCapability,
          latestVoiceCapture: matchedVoiceCapture,
          target: activeTarget,
        })) {
          if (event.type === 'beat-planned' && event.modality === 'text' && event.beatIndex > 0) {
            delayedTailPending = true;
          }
          if (
            event.type === 'first-beat-sealed'
            && delayedTailPending
            && !submittingReleasedForPendingTail
          ) {
            submittingReleasedForPendingTail = true;
            activeSubmit.interruptible = true;
            if (submittingLockTokenRef.current === submittingLockToken) {
              input.setSubmittingThreadId(null);
            }
          }
          matchConversationTurnEvent(event, {
            'turn-started': () => undefined,
            'reasoning-delta': (nextEvent) => {
              submitSession = input.applyDriverEffects(effectiveThreadId, reduceAgentSubmitDriverEvent({
                state: submitSession,
                event: nextEvent,
                updatedAtMs: Date.now(),
              }));
            },
            'text-delta': (nextEvent) => {
              submitSession = input.applyDriverEffects(effectiveThreadId, reduceAgentSubmitDriverEvent({
                state: submitSession,
                event: nextEvent,
                updatedAtMs: Date.now(),
              }));
            },
            'first-beat-sealed': (nextEvent) => {
              submitSession = input.applyDriverEffects(effectiveThreadId, reduceAgentSubmitDriverEvent({
                state: submitSession,
                event: nextEvent,
                updatedAtMs: Date.now(),
              }));
            },
            'beat-planned': (nextEvent) => {
              submitSession = input.applyDriverEffects(effectiveThreadId, reduceAgentSubmitDriverEvent({
                state: submitSession,
                event: nextEvent,
                updatedAtMs: Date.now(),
              }));
            },
            'beat-delivery-started': () => undefined,
            'beat-delivered': () => undefined,
            'artifact-ready': () => undefined,
            'projection-rebuilt': (nextEvent) => {
              const projectionEffects = reduceAgentSubmitDriverEvent({
                state: submitSession,
                event: nextEvent,
                updatedAtMs: Date.now(),
              });
              submitSession = input.applyDriverEffects(effectiveThreadId, projectionEffects);
              if (!projectionEffects.awaitRefresh) {
                return;
              }
              const requestedProjectionVersion = projectionEffects.awaitRefresh.requestedProjectionVersion;
              projectionRefreshPromise = chatAgentStoreClient.getThreadBundle(effectiveThreadId)
                .then((refreshedBundle) => {
                  submitSession = input.applyDriverEffects(effectiveThreadId, resolveAgentSubmitDriverProjectionRefresh({
                    state: submitSession,
                    requestedProjectionVersion,
                    streamSnapshot: getStreamState(effectiveThreadId),
                    refreshedBundle,
                    draftText: input.currentDraftTextRef.current,
                  }));
                })
                .catch((refreshError) => {
                  projectionRefreshError = refreshError;
                });
            },
            'turn-completed': (nextEvent) => {
              submitSession = input.applyDriverEffects(effectiveThreadId, reduceAgentSubmitDriverEvent({
                state: submitSession,
                event: nextEvent,
                updatedAtMs: Date.now(),
              }));
            },
            'turn-failed': (nextEvent) => {
              submitSession = input.applyDriverEffects(effectiveThreadId, reduceAgentSubmitDriverEvent({
                state: submitSession,
                event: nextEvent,
                updatedAtMs: Date.now(),
              }));
            },
            'turn-canceled': (nextEvent) => {
              submitSession = input.applyDriverEffects(effectiveThreadId, reduceAgentSubmitDriverEvent({
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
          ? await chatAgentStoreClient.getThreadBundle(effectiveThreadId)
          : null;
        submitSession = input.applyDriverEffects(effectiveThreadId, resolveCompletedAgentSubmitDriverCheckpoint({
          state: submitSession,
          refreshedBundle,
          streamSnapshot: getStreamState(effectiveThreadId),
        }));

        if (submitSession.lifecycle.terminal === 'failed' && submitSession.lifecycle.error) {
          throw toStructuredProviderError(submitSession.lifecycle.error);
        }
        if (submitSession.lifecycle.terminal === 'canceled') {
          if (activeSubmit.overrideRequested) {
            return;
          }
          throw toAbortError(input.t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }));
        }
        assertAgentTurnLifecycleCompleted(submitSession.lifecycle);
      })();
      activeSubmit.promise = submitRunPromise;
      try {
        await submitRunPromise;
      } catch (error) {
        const streamSnapshot = getStreamState(effectiveThreadId);
        const runtimeError = streamSnapshot.cancelSource === 'user'
          ? {
            code: 'OPERATION_ABORTED',
            message: input.t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }),
          }
          : toChatAgentRuntimeError(error);
        if (activeSubmit.overrideRequested && runtimeError.code === 'OPERATION_ABORTED') {
          return;
        }
        const draftUpdatedAtMs = Date.now();
        const draft = await chatAgentStoreClient.putDraft({
          threadId: effectiveThreadId,
          text: submittedText,
          updatedAtMs: draftUpdatedAtMs,
        });
        let refreshedBundle: AgentLocalThreadBundle | null = null;
        if (submitSession.lifecycle.projectionVersion) {
          refreshedBundle = await chatAgentStoreClient.getThreadBundle(effectiveThreadId);
        }
        submitSession = input.applyDriverEffects(effectiveThreadId, resolveInterruptedAgentSubmitDriverCheckpoint({
          state: submitSession,
          refreshedBundle,
          runtimeError,
          draft,
          updatedAtMs: draftUpdatedAtMs,
          streamSnapshot,
        }));
        throw new Error(runtimeError.message, { cause: error });
      } finally {
        if (activeSubmitRef.current === activeSubmit) {
          activeSubmitRef.current = null;
        }
        if (submittingLockTokenRef.current === submittingLockToken) {
          input.setSubmittingThreadId(null);
        }
      }
    } catch (error) {
      input.reportHostError(error);
      throw error;
    }
  }, [input, uploadPendingAttachment]);

  return {
    handleSelectAgent,
    handleSelectThread,
    handleSubmit,
  };
}
