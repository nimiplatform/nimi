import type {
  AgentLocalMessageRecord,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { createNimiClientId } from '@nimiplatform/sdk';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  createInitialAgentSubmitDriverState,
  resolveInterruptedAgentSubmitDriverCheckpoint,
} from './chat-agent-shell-submit-driver';
import {
  createEmptyAgentThreadBundle,
  replaceAgentBundleMessage,
} from './chat-agent-shell-bundle';
import { setAgentVisibleProjection } from './chat-agent-visible-projection-store';
import {
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import {
  bundleQueryKey,
  normalizeText,
} from './chat-agent-shell-core';
import {
  getStreamState,
  startStream,
} from '../turns/stream-controller';
import { resolveAgentTurnTotalTimeoutMs } from './chat-agent-timeouts';
import {
  describeRuntimeAgentTextReadiness,
  isRuntimeAgentTextReadinessReady,
} from '@renderer/infra/runtime-agent-execution-config';
import { buildAgentUserProjection } from './chat-agent-user-projection';
import {
  assertAgentSubmitSchedulingAllowed,
  ensureThreadAnchorBindingForTarget,
  isAbortLikeSubmitError,
  uploadPendingAttachment,
} from './chat-agent-shell-host-actions-helpers';
import { runActiveAgentSubmit } from './chat-agent-shell-host-actions-submit-run';
import {
  rollbackOptimisticUserProjection,
  toFallbackThreadRecord,
} from './chat-agent-shell-host-actions-submit-helpers';
import type { RuntimeLogMessage } from '@nimiplatform/kit/telemetry';
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
  let userProjectionApplied = false;
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
        selectedLocalAgentRef: activeTarget.localAgentRef,
        activeThreadId: input.hostInput.activeThreadId,
        submittedTextLength: submittedText.length,
        attachmentCount: input.payload.attachments.length,
      },
    });

    const runtimeReadiness = await input.hostInput.getRuntimeAgentExecutionReadiness();
    if (!isRuntimeAgentTextReadinessReady(runtimeReadiness)) {
      throw new Error(
        input.hostInput.runtimeAgentTextDisabledReason
          || describeRuntimeAgentTextReadiness(runtimeReadiness, input.hostInput.t('Chat.agentSubmitRuntimeTextUnavailable', {
            defaultValue: 'Runtime Agent text execution is not ready.',
          })),
      );
    }
    await assertAgentSubmitSchedulingAllowed({
      aiConfig: input.hostInput.aiConfig,
      t: input.hostInput.t,
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
        selectedLocalAgentRef: activeTarget.localAgentRef,
        threadId: effectiveThreadId,
        conversationAnchorId,
      },
    });
    const fallbackThreadRecord = toFallbackThreadRecord(effectiveThreadRecord);

    const existingSubmit = input.activeSubmitsByThreadRef.current.get(effectiveThreadId) || null;
    if (existingSubmit && existingSubmit.threadId === effectiveThreadId && existingSubmit.interruptible) {
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

    const userTurnId = createNimiClientId('agent-turn-user');
    const assistantTurnId = createNimiClientId('agent-turn');
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
      ? buildAgentUserProjection({
        threadId: effectiveThreadId,
        agentId: activeTarget.localAgentRef,
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
      input.hostInput.currentComposerTextRef.current = '';
      input.hostInput.setBundleCache(effectiveThreadId, (current) => {
        const base = current || createEmptyAgentThreadBundle(optimisticThreadRecord);
        return {
          ...base,
          thread: optimisticThreadRecord,
          messages: optimisticUserProjection.messages.reduce<AgentLocalMessageRecord[]>(
            (messages, message) => replaceAgentBundleMessage(messages, message),
            base.messages,
          ),
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

    const uploadedAttachments = input.payload.attachments.length > 0
      ? await Promise.all(input.payload.attachments.map((attachment) => uploadPendingAttachment(input.hostInput, attachment)))
      : [];
    const userProjection = buildAgentUserProjection({
      threadId: effectiveThreadId,
      agentId: activeTarget.localAgentRef,
      conversationAnchorId,
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

    const userThreadRecord: AgentLocalThreadRecord = {
      ...fallbackThreadRecord,
      updatedAtMs: createdAtMs,
      lastMessageAtMs: userProjection.lastMessageAtMs,
      targetSnapshot: activeTarget,
    };
    const baseUserBundle = input.hostInput.bundle || createEmptyAgentThreadBundle(userThreadRecord);
    const userBundle = {
      ...baseUserBundle,
      thread: userThreadRecord,
      messages: userProjection.messages.reduce<AgentLocalMessageRecord[]>(
        (messages, message) => replaceAgentBundleMessage(messages, message),
        baseUserBundle.messages,
      ),
    };
    userProjectionApplied = true;
    input.hostInput.queryClient.setQueryData(bundleQueryKey(effectiveThreadId), userBundle);
    setAgentVisibleProjection(effectiveThreadId, userBundle);
    input.hostInput.syncSelectionToThread(userBundle.thread);
    let submitSession = createInitialAgentSubmitDriverState({
      fallbackThread: fallbackThreadRecord,
      assistantMessageId,
      assistantPlaceholder,
      submittedText,
      workingBundle: userBundle,
    });

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
      signal: abortController.signal,
      textModelContextTokens: input.hostInput.textModelContextTokens,
      textMaxOutputTokensRequested: input.hostInput.textMaxOutputTokensRequested,
      target: activeTarget,
      submitSession,
      currentComposerText: () => input.hostInput.currentComposerTextRef.current,
      releaseSubmittingIfCurrent,
    });
    safeLogAgentSubmit({
      message: 'action:submit:runtime-turn-started',
      details: {
        selectedLocalAgentRef: activeTarget.localAgentRef,
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
          selectedLocalAgentRef: activeTarget.localAgentRef,
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
          selectedLocalAgentRef: activeTarget.localAgentRef,
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
      input.hostInput.currentComposerTextRef.current = submittedText;
      submitSession = input.hostInput.applyDriverEffects(effectiveThreadId, resolveInterruptedAgentSubmitDriverCheckpoint({
        state: submitSession,
        refreshedBundle: null,
        runtimeError,
        updatedAtMs: Date.now(),
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
        userProjectionApplied,
      },
    });
    if (!userProjectionApplied) {
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
