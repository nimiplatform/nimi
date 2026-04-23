import type {
  AgentLocalMessageRecord,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import {
  peekDesktopAISchedulingForEvidence,
  recordDesktopAISnapshot,
  resolveAIConfigSchedulingTargetForCapability,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  createInitialAgentSubmitDriverState,
  resolveInterruptedAgentSubmitDriverCheckpoint,
} from './chat-agent-shell-submit-driver';
import {
  createEmptyAgentThreadBundle,
  replaceAgentBundleMessage,
  resolveAuthoritativeAgentThreadBundle,
} from './chat-agent-shell-bundle';
import {
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import { cancelPendingAgentFollowUpChain } from './chat-agent-orchestration';
import {
  createAISnapshot,
} from './conversation-capability';
import {
  refreshAgentEffectiveCapabilityResolution,
  refreshConversationCapabilityProjections,
} from './conversation-capability-projection';
import {
  bundleQueryKey,
  normalizeText,
  toConversationHistoryMessages,
  upsertThreadSummary,
} from './chat-agent-shell-core';
import {
  getStreamState,
  startStream,
} from '../turns/stream-controller';
import { resolveAgentTurnTotalTimeoutMs } from './chat-agent-timeouts';
import { ensureAgentConversationSubmitRouteReady } from './conversation-submit-readiness';
import { buildAgentUserProjectionCommit } from './chat-agent-user-projection';
import {
  writeDesktopAgentUserTurnMemory,
} from './chat-agent-runtime-memory';
import {
  assertAgentSubmitSchedulingAllowed,
  ensureThreadAnchorBindingForTarget,
  isAbortLikeSubmitError,
  uploadPendingAttachment,
} from './chat-agent-shell-host-actions-helpers';
import { runActiveAgentSubmit } from './chat-agent-shell-host-actions-submit-run';
import {
  buildVoiceWorkflowExecutionSnapshots,
  rollbackOptimisticUserProjection,
  toFallbackThreadRecord,
} from './chat-agent-shell-host-actions-submit-helpers';
import type { RuntimeLogMessage } from '@runtime/telemetry/logger';
import type {
  ActiveSubmitRegistryRef,
  AgentConversationSubmitPayload,
  LockTokenRef,
  UseAgentConversationHostActionsInput,
  ActiveAgentSubmit,
} from './chat-agent-shell-host-actions-types';

function safeLogAgentSubmit(details: {
  message: RuntimeLogMessage;
  level?: 'info' | 'warn' | 'error';
  details?: Record<string, unknown>;
}): void {
  if (typeof window === 'undefined') {
    return;
  }
  logRendererEvent({
    level: details.level || 'info',
    area: 'agent-chat-submit',
    message: details.message,
    details: details.details || {},
  });
}

export async function submitAgentConversationTurn(input: {
  hostInput: UseAgentConversationHostActionsInput;
  payload: AgentConversationSubmitPayload;
  activeSubmitsByThreadRef: ActiveSubmitRegistryRef;
  submittingLockTokenRef: LockTokenRef;
}): Promise<void> {
  let optimisticThreadId: string | null = null;
  let optimisticUserMessageIds: string[] = [];
  let optimisticBaseThread: AgentLocalThreadRecord | null = null;
  let authoritativeUserCommitStored = false;
  let submittedTextForRecovery = '';
  let submittingLockToken: number | null = null;

  const releaseSubmittingIfCurrent = () => {
    if (submittingLockToken !== null && input.submittingLockTokenRef.current === submittingLockToken) {
      input.hostInput.setSubmittingThreadId(null);
    }
  };

  try {
    const activeTarget = input.hostInput.activeTarget;
    if (!activeTarget) {
      throw new Error(input.hostInput.t('Chat.agentSubmitMissingThread', {
        defaultValue: 'Select an agent friend before sending a message.',
      }));
    }
    const submittedText = input.payload.text.trim();
    submittedTextForRecovery = submittedText;
    if (!submittedText && input.payload.attachments.length === 0) {
      return;
    }
    safeLogAgentSubmit({
      message: 'action:submit:start',
      details: {
        selectedAgentId: activeTarget.agentId,
        activeThreadId: input.hostInput.activeThreadId,
        submittedTextLength: submittedText.length,
        attachmentCount: input.payload.attachments.length,
      },
    });

    let effectiveThreadRecord: AgentLocalThreadSummary | AgentLocalThreadRecord | null = input.hostInput.selectedThreadRecord;
    let effectiveThreadId = input.hostInput.activeThreadId;
    const threadContext = await ensureThreadAnchorBindingForTarget({
      input: input.hostInput,
      target: activeTarget,
      thread: effectiveThreadId && effectiveThreadRecord ? effectiveThreadRecord : null,
    });
    effectiveThreadRecord = threadContext.thread;
    effectiveThreadId = threadContext.thread.id;
    const conversationAnchorId = threadContext.anchorBinding.conversationAnchorId;
    safeLogAgentSubmit({
      message: 'action:submit:thread-anchor-ready',
      details: {
        selectedAgentId: activeTarget.agentId,
        threadId: effectiveThreadId,
        conversationAnchorId,
      },
    });
    const fallbackThreadRecord = toFallbackThreadRecord(effectiveThreadRecord);

    const existingSubmit = input.activeSubmitsByThreadRef.current.get(effectiveThreadId) || null;
    if (existingSubmit && existingSubmit.threadId === effectiveThreadId && existingSubmit.interruptible) {
      cancelPendingAgentFollowUpChain(effectiveThreadId);
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
    const optimisticPreviewAttachments = input.payload.attachments
      .filter((attachment) => attachment.kind === 'image' && normalizeText(attachment.previewUrl))
      .map((attachment) => ({
        kind: 'image' as const,
        url: attachment.previewUrl,
        mimeType: normalizeText(attachment.file.type) || null,
        name: attachment.name,
        resourceId: null,
      }));
    const optimisticUserProjection = submittedText || optimisticPreviewAttachments.length > 0
      ? buildAgentUserProjectionCommit({
        threadId: effectiveThreadId,
        agentId: activeTarget.agentId,
        conversationAnchorId,
        turnId: userTurnId,
        submittedText,
        uploadedAttachments: optimisticPreviewAttachments,
        createdAtMs,
      })
      : null;
    if (optimisticUserProjection) {
      const optimisticThreadRecord: AgentLocalThreadRecord = {
        ...fallbackThreadRecord,
        updatedAtMs: createdAtMs,
        lastMessageAtMs: optimisticUserProjection.lastMessageAtMs,
        targetSnapshot: activeTarget,
      };
      input.hostInput.currentDraftTextRef.current = '';
      input.hostInput.setThreadsCache((current) => upsertThreadSummary(current, optimisticThreadRecord));
      input.hostInput.setBundleCache(effectiveThreadId, (current) => {
        const base = current || createEmptyAgentThreadBundle(optimisticThreadRecord);
        return {
          ...base,
          thread: optimisticThreadRecord,
          messages: optimisticUserProjection.messages.reduce<AgentLocalMessageRecord[]>(
            (messages, message) => replaceAgentBundleMessage(messages, message),
            base.messages,
          ),
          draft: null,
        };
      });
      optimisticThreadId = effectiveThreadId;
      optimisticUserMessageIds = optimisticUserProjection.messages.map((message) => message.id);
      optimisticBaseThread = fallbackThreadRecord;
    }

    submittingLockToken = input.submittingLockTokenRef.current + 1;
    input.submittingLockTokenRef.current = submittingLockToken;
    input.hostInput.setSubmittingThreadId(effectiveThreadId);
    input.hostInput.setFooterHostState(effectiveThreadId, null);

    const refreshedAgentResolution = await ensureAgentConversationSubmitRouteReady({
      t: input.hostInput.t,
    });
    await assertAgentSubmitSchedulingAllowed({
      aiConfig: input.hostInput.aiConfig,
      t: input.hostInput.t,
    });

    const uploadedAttachments = input.payload.attachments.length > 0
      ? await Promise.all(input.payload.attachments.map((attachment) => uploadPendingAttachment(input.hostInput, attachment)))
      : [];
    const userProjection = buildAgentUserProjectionCommit({
      threadId: effectiveThreadId,
      agentId: activeTarget.agentId,
      conversationAnchorId,
      turnId: userTurnId,
      submittedText,
      uploadedAttachments,
      createdAtMs,
    });
    const conversationHistoryBeforeSubmit = toConversationHistoryMessages(input.hostInput.bundle?.messages || []);
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

    input.hostInput.currentDraftTextRef.current = submittedText;
    const latestVoiceCapture = input.hostInput.latestVoiceCaptureByThreadRef.current[effectiveThreadId] || null;
    const matchedVoiceCapture = latestVoiceCapture?.transcriptText === submittedText
      ? latestVoiceCapture
      : null;
    let submitSession = createInitialAgentSubmitDriverState({
      fallbackThread: fallbackThreadRecord,
      assistantMessageId,
      assistantPlaceholder,
      submittedText,
      workingBundle: input.hostInput.bundle,
    });

    await chatAgentStoreClient.deleteDraft(effectiveThreadId);
    await writeDesktopAgentUserTurnMemory({
      agentId: activeTarget.agentId,
      displayName: activeTarget.displayName,
      worldId: activeTarget.worldId,
      submittedText,
      turnId: userTurnId,
      threadId: effectiveThreadId,
    });

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
      beats: [...userProjection.beats],
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
    authoritativeUserCommitStored = true;
    const userBundle = resolveAuthoritativeAgentThreadBundle({
      optimisticBundle: userCommitted.bundle,
      refreshedBundle: null,
      clearDraft: true,
    });
    if (!userBundle) {
      throw new Error('agent-local-chat-v1 user commit did not return a projection bundle');
    }
    input.hostInput.setThreadsCache((current) => upsertThreadSummary(current, userBundle.thread));
    input.hostInput.queryClient.setQueryData(bundleQueryKey(effectiveThreadId), userBundle);
    input.hostInput.syncSelectionToThread(userBundle.thread);
    submitSession = createInitialAgentSubmitDriverState({
      fallbackThread: fallbackThreadRecord,
      assistantMessageId,
      assistantPlaceholder,
      submittedText,
      workingBundle: userBundle,
    });

    const runtimeEvidence = await peekDesktopAISchedulingForEvidence({
      scopeRef: input.hostInput.aiConfig.scopeRef,
      target: resolveAIConfigSchedulingTargetForCapability(input.hostInput.aiConfig, 'text.generate'),
    });
    const textExecutionSnapshot = createAISnapshot({
      config: input.hostInput.aiConfig,
      capability: 'text.generate',
      projection: refreshedAgentResolution.textProjection!,
      agentResolution: refreshedAgentResolution,
      runtimeEvidence,
    });
    recordDesktopAISnapshot(textExecutionSnapshot);

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
      effectiveAgentResolution = useAppStore.getState().agentEffectiveCapabilityResolution || effectiveAgentResolution;
    }

    const imageExecutionSnapshot = effectiveAgentResolution.imageProjection?.supported
      && effectiveAgentResolution.imageProjection?.resolvedBinding
      ? createAISnapshot({
        config: input.hostInput.aiConfig,
        capability: 'image.generate',
        projection: effectiveAgentResolution.imageProjection,
        agentResolution: effectiveAgentResolution,
        runtimeEvidence: await peekDesktopAISchedulingForEvidence({
          scopeRef: input.hostInput.aiConfig.scopeRef,
          target: resolveAIConfigSchedulingTargetForCapability(input.hostInput.aiConfig, 'image.generate'),
        }),
      })
      : null;
    if (imageExecutionSnapshot) {
      recordDesktopAISnapshot(imageExecutionSnapshot);
    }
    const voiceExecutionSnapshot = effectiveAgentResolution.voiceProjection?.supported
      && effectiveAgentResolution.voiceProjection?.resolvedBinding
      ? createAISnapshot({
        config: input.hostInput.aiConfig,
        capability: 'audio.synthesize',
        projection: effectiveAgentResolution.voiceProjection,
        agentResolution: effectiveAgentResolution,
        runtimeEvidence: await peekDesktopAISchedulingForEvidence({
          scopeRef: input.hostInput.aiConfig.scopeRef,
          target: resolveAIConfigSchedulingTargetForCapability(input.hostInput.aiConfig, 'audio.synthesize'),
        }),
      })
      : null;
    if (voiceExecutionSnapshot) {
      recordDesktopAISnapshot(voiceExecutionSnapshot);
    }
    const voiceWorkflowExecutionSnapshotByCapability = await buildVoiceWorkflowExecutionSnapshots(
      {
        hostInput: input.hostInput,
        agentResolution: effectiveAgentResolution,
      },
    );

    const abortController = startStream(
      effectiveThreadId,
      resolveAgentTurnTotalTimeoutMs(input.hostInput.aiConfig),
    );
    const activeSubmit: ActiveAgentSubmit = {
      threadId: effectiveThreadId,
      turnId: assistantTurnId,
      interruptible: false,
      overrideRequested: false,
      abort: () => abortController.abort(),
      promise: Promise.resolve(),
    };
    input.activeSubmitsByThreadRef.current.set(effectiveThreadId, activeSubmit);
    const history = conversationHistoryBeforeSubmit;
    const submitRunPromise = runActiveAgentSubmit({
      activeSubmit,
      input: input.hostInput,
      threadId: effectiveThreadId,
      conversationAnchorId,
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
      textModelContextTokens: input.hostInput.textModelContextTokens,
      textMaxOutputTokensRequested: input.hostInput.textMaxOutputTokensRequested,
      target: activeTarget,
      submitSession,
      currentDraftText: () => input.hostInput.currentDraftTextRef.current,
      releaseSubmittingIfCurrent,
    });
    safeLogAgentSubmit({
      message: 'action:submit:runtime-turn-started',
      details: {
        selectedAgentId: activeTarget.agentId,
        threadId: effectiveThreadId,
        conversationAnchorId,
        assistantTurnId,
        userTurnId,
      },
    });
    activeSubmit.promise = submitRunPromise.then(() => undefined);

    try {
      submitSession = await submitRunPromise;
      safeLogAgentSubmit({
        message: 'action:submit:runtime-turn-completed',
        details: {
          selectedAgentId: activeTarget.agentId,
          threadId: effectiveThreadId,
          conversationAnchorId,
          assistantTurnId,
        },
      });
    } catch (error) {
      const streamSnapshot = getStreamState(effectiveThreadId);
      const runtimeError = streamSnapshot.cancelSource === 'user'
        ? {
          code: 'OPERATION_ABORTED',
          message: input.hostInput.t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }),
        }
        : toChatAgentRuntimeError(error);
      safeLogAgentSubmit({
        level: 'warn',
        message: 'action:submit:runtime-turn-failed',
        details: {
          selectedAgentId: activeTarget.agentId,
          threadId: effectiveThreadId,
          conversationAnchorId,
          assistantTurnId,
          error: runtimeError.message,
          reasonCode: runtimeError.code,
        },
      });
      if (activeSubmit.overrideRequested && runtimeError.code === 'OPERATION_ABORTED') {
        return;
      }
      const draftUpdatedAtMs = Date.now();
      const draft = await chatAgentStoreClient.putDraft({
        threadId: effectiveThreadId,
        text: submittedText,
        updatedAtMs: draftUpdatedAtMs,
      });
      const refreshedBundle = submitSession.lifecycle.projectionVersion
        ? await chatAgentStoreClient.getThreadBundle(effectiveThreadId)
        : null;
      submitSession = input.hostInput.applyDriverEffects(effectiveThreadId, resolveInterruptedAgentSubmitDriverCheckpoint({
        state: submitSession,
        refreshedBundle,
        runtimeError,
        draft,
        updatedAtMs: draftUpdatedAtMs,
        streamSnapshot,
      }));
      throw new Error(runtimeError.message, { cause: error });
    } finally {
      if (input.activeSubmitsByThreadRef.current.get(effectiveThreadId) === activeSubmit) {
        input.activeSubmitsByThreadRef.current.delete(effectiveThreadId);
      }
      releaseSubmittingIfCurrent();
    }
  } catch (error) {
    safeLogAgentSubmit({
      level: 'error',
      message: 'action:submit:failed-before-terminal',
      details: {
        error: error instanceof Error ? error.message : String(error || ''),
        optimisticThreadId,
        authoritativeUserCommitStored,
      },
    });
    if (!authoritativeUserCommitStored) {
      await rollbackOptimisticUserProjection({
        hostInput: input.hostInput,
        optimisticThreadId,
        optimisticBaseThread,
        optimisticUserMessageIds,
        submittedTextForRecovery,
      });
    }
    releaseSubmittingIfCurrent();
    input.hostInput.reportHostError(error);
    throw error;
  }
}
