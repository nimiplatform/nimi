import { dataSync } from '@runtime/data-sync';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  asNimiError,
  createRuntimeProtectedScopeHelper,
  type AgentPresentationBackendKind,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  resolveAIConfigSchedulingTargetForCapability,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  bundleQueryKey,
  normalizeText,
  upsertBundleDraft,
  THREADS_QUERY_KEY,
  upsertThreadSummary,
} from './chat-agent-shell-core';
import { createEmptyAgentThreadBundle } from './chat-agent-shell-bundle';
import { probeExecutionSchedulingGuard } from './chat-shared-execution-scheduling-guard';
import {
  clearAgentConversationAnchorBinding,
  getAgentConversationAnchorBinding,
  persistAgentConversationAnchorBinding,
  type AgentConversationAnchorBinding,
} from './chat-agent-anchor-binding-storage';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentChatUserAttachment } from './chat-nimi-execution-engine';
import type { UseAgentConversationHostActionsInput } from './chat-agent-shell-host-actions-types';

let runtimeProtectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

export function isAbortLikeSubmitError(error: unknown): boolean {
  const message = String((error instanceof Error ? error.message : error) || '').toLowerCase();
  return message.includes('aborted')
    || message.includes('cancelled')
    || message.includes('canceled')
    || message.includes('generation stopped');
}

function requireRuntimeSubjectUserId(): string {
  const subjectUserId = normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id);
  if (!subjectUserId) {
    throw new Error('desktop agent chat requires authenticated subject user id for runtime.agent');
  }
  return subjectUserId;
}

function normalizeRuntimeError(error: unknown, actionHint: string) {
  return asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint,
    source: 'runtime',
  });
}

function isRecoverableRuntimeAnchorError(error: unknown): boolean {
  const normalized = normalizeRuntimeError(error, 'check_runtime_agent_anchor');
  const reasonCode = normalizeText(normalized.reasonCode);
  const message = normalizeText(normalized.message).toLowerCase();
  return reasonCode === 'RUNTIME_GRPC_NOT_FOUND'
    || reasonCode === 'RUNTIME_GRPC_FAILED_PRECONDITION'
    || message.includes('conversation anchor not found')
    || message.includes('conversation anchor is closed')
    || message.includes('conversation anchor agent_id mismatch');
}

function getRuntimeProtectedAccess() {
  if (runtimeProtectedAccess) {
    return runtimeProtectedAccess;
  }
  const runtime = getPlatformClient().runtime;
  runtimeProtectedAccess = createRuntimeProtectedScopeHelper({
    runtime,
    getSubjectUserId: async () => requireRuntimeSubjectUserId(),
  });
  return runtimeProtectedAccess;
}

function toRuntimePresentationBackendKind(
  value: NonNullable<AgentLocalTargetSnapshot['presentationProfile']>['backendKind'],
): AgentPresentationBackendKind {
  switch (value) {
    case 'vrm':
      return 1;
    case 'live2d':
      return 2;
    case 'sprite2d':
      return 3;
    case 'canvas2d':
      return 4;
    case 'video':
      return 5;
    default:
      return 0;
  }
}

async function syncRuntimePresentationProfile(input: {
  target: AgentLocalTargetSnapshot;
  context: {
    appId: string;
    subjectUserId: string;
  };
}): Promise<void> {
  const profile = input.target.presentationProfile;
  if (!profile?.avatarAssetRef) {
    return;
  }
  const runtime = getPlatformClient().runtime;
  const protectedAccess = getRuntimeProtectedAccess();
  await protectedAccess.withScopes(['runtime.agent.write'], (options) => runtime.agent.setPresentationProfile({
    context: input.context,
    agentId: input.target.agentId,
    mutation: {
      oneofKind: 'profile',
      profile: {
        backendKind: toRuntimePresentationBackendKind(profile.backendKind),
        avatarAssetRef: profile.avatarAssetRef,
        expressionProfileRef: profile.expressionProfileRef || '',
        idlePreset: profile.idlePreset || '',
        interactionPolicyRef: profile.interactionPolicyRef || '',
        defaultVoiceReference: profile.defaultVoiceReference || '',
      },
    },
  }, options));
}

export async function ensureRuntimeAgentExists(target: AgentLocalTargetSnapshot): Promise<void> {
  const runtime = getPlatformClient().runtime;
  const protectedAccess = getRuntimeProtectedAccess();
  const subjectUserId = requireRuntimeSubjectUserId();
  const context = {
    appId: runtime.appId,
    subjectUserId,
  };

  try {
    const response = await protectedAccess.withScopes(['runtime.agent.read'], (options) => runtime.agent.getAgent({
      context,
      agentId: target.agentId,
    }, options));
    if (Number(response.agent?.lifecycleStatus) === 2) {
      await syncRuntimePresentationProfile({ target, context });
      return;
    }
  } catch (error) {
    const normalized = normalizeRuntimeError(error, 'check_runtime_agent');
    if (normalized.reasonCode !== 'RUNTIME_GRPC_NOT_FOUND') {
      throw normalized;
    }
  }

  try {
    await protectedAccess.withScopes(['runtime.agent.admin'], (options) => runtime.agent.initializeAgent({
      context,
      agentId: target.agentId,
      displayName: target.displayName || target.agentId,
      autonomyConfig: undefined,
      worldId: normalizeText(target.worldId),
      metadata: undefined,
    }, options));
  } catch (error) {
    const normalized = normalizeRuntimeError(error, 'initialize_runtime_agent');
    if (normalized.reasonCode !== 'RUNTIME_GRPC_ALREADY_EXISTS') {
      throw normalized;
    }
  }

  await syncRuntimePresentationProfile({ target, context });
}

export async function assertAgentSubmitSchedulingAllowed(input: {
  aiConfig: UseAgentConversationHostActionsInput['aiConfig'];
  t: UseAgentConversationHostActionsInput['t'];
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

export async function persistDraftForThread(
  input: UseAgentConversationHostActionsInput,
  threadId: string | null,
): Promise<void> {
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
}

async function openConversationAnchorForTarget(
  target: AgentLocalTargetSnapshot,
): Promise<string> {
  const runtime = getPlatformClient().runtime;
  const protectedAccess = getRuntimeProtectedAccess();
  await ensureRuntimeAgentExists(target);
  const snapshot = await protectedAccess.withScopes(
    ['runtime.agent.turn.write'],
    (options) => runtime.agent.anchors.open({
      agentId: target.agentId,
      metadata: {
        surface: 'desktop-agent-chat',
      },
    }, options),
  ).catch((error) => {
    const normalized = normalizeRuntimeError(error, 'open_runtime_agent_anchor');
    const reasonCode = normalizeText(normalized.reasonCode) || 'RUNTIME_CALL_FAILED';
    throw new Error(
      `open runtime agent anchor failed: ${normalized.message} [${reasonCode}]`,
      { cause: error },
    );
  });
  const record = snapshot as unknown as Record<string, unknown>;
  const anchorRecord = record.anchor && typeof record.anchor === 'object'
    ? record.anchor as Record<string, unknown>
    : null;
  const conversationAnchorId = normalizeText(
    anchorRecord?.conversationAnchorId
      ?? anchorRecord?.conversation_anchor_id
      ?? record.conversationAnchorId
      ?? record.conversation_anchor_id,
  );
  if (!conversationAnchorId) {
    throw new Error('runtime.agent anchor open did not return conversationAnchorId');
  }
  return conversationAnchorId;
}

async function ensureConversationAnchorBindingUpstream(input: {
  threadId: string;
  target: AgentLocalTargetSnapshot;
  binding: AgentConversationAnchorBinding;
}): Promise<AgentConversationAnchorBinding | null> {
  const runtime = getPlatformClient().runtime;
  const protectedAccess = getRuntimeProtectedAccess();
  await ensureRuntimeAgentExists(input.target);
  try {
    await protectedAccess.withScopes(
      ['runtime.agent.turn.read'],
      (options) => runtime.agent.anchors.getSnapshot({
        agentId: input.target.agentId,
        conversationAnchorId: input.binding.conversationAnchorId,
      }, options),
    );
    return input.binding;
  } catch (error) {
    if (!isRecoverableRuntimeAnchorError(error)) {
      const normalized = normalizeRuntimeError(error, 'get_runtime_agent_anchor_snapshot');
      const reasonCode = normalizeText(normalized.reasonCode) || 'RUNTIME_CALL_FAILED';
      throw new Error(
        `get runtime agent anchor snapshot failed: ${normalized.message} [${reasonCode}]`,
        { cause: error },
      );
    }
    clearAgentConversationAnchorBinding(input.threadId);
    return null;
  }
}

export async function createThreadForTarget(
  input: UseAgentConversationHostActionsInput,
  target: AgentLocalTargetSnapshot,
): Promise<AgentLocalThreadSummary> {
  const timestampMs = Date.now();
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
  void input.queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
  input.currentDraftTextRef.current = '';
  input.syncSelectionToThread(thread);
  return thread;
}

export async function ensureThreadAnchorBindingForTarget(input: {
  input: UseAgentConversationHostActionsInput;
  target: AgentLocalTargetSnapshot;
  thread: AgentLocalThreadSummary | AgentLocalThreadRecord | null;
}): Promise<{
  thread: AgentLocalThreadSummary | AgentLocalThreadRecord;
  anchorBinding: AgentConversationAnchorBinding;
}> {
  const ensuredThread = input.thread ?? await createThreadForTarget(input.input, input.target);
  const existingBinding = getAgentConversationAnchorBinding(ensuredThread.id);
  if (existingBinding) {
    if (existingBinding.agentId !== input.target.agentId) {
      throw new Error('agent thread anchor binding does not match selected agent');
    }
    const runtimeBinding = await ensureConversationAnchorBindingUpstream({
      threadId: ensuredThread.id,
      target: input.target,
      binding: existingBinding,
    });
    if (runtimeBinding) {
      return {
        thread: ensuredThread,
        anchorBinding: runtimeBinding,
      };
    }
  }
  const conversationAnchorId = await openConversationAnchorForTarget(input.target);
  const anchorBinding = persistAgentConversationAnchorBinding({
    threadId: ensuredThread.id,
    agentId: input.target.agentId,
    conversationAnchorId,
    updatedAtMs: Date.now(),
  });
  return {
    thread: ensuredThread,
    anchorBinding,
  };
}

export async function uploadPendingAttachment(
  input: UseAgentConversationHostActionsInput,
  attachment: PendingAttachment,
): Promise<AgentChatUserAttachment> {
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
}
