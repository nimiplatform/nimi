import { dataSync } from '@runtime/data-sync';
import type {
  AgentLocalTargetSnapshot,
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
import { probeExecutionSchedulingGuard } from './chat-execution-scheduling-guard';
import { findAgentConversationThreadByAgentId } from './chat-agent-thread-model';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentChatUserAttachment } from './chat-ai-execution-engine';
import type { UseAgentConversationHostActionsInput } from './chat-agent-shell-host-actions-types';

export function isAbortLikeSubmitError(error: unknown): boolean {
  const message = String((error instanceof Error ? error.message : error) || '').toLowerCase();
  return message.includes('aborted')
    || message.includes('cancelled')
    || message.includes('canceled')
    || message.includes('generation stopped');
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

export async function createOrRestoreThreadForTarget(
  input: UseAgentConversationHostActionsInput,
  target: AgentLocalTargetSnapshot,
): Promise<AgentLocalThreadSummary> {
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
    if (String((error instanceof Error ? error.message : error) || '').includes('duplicate primary key or unique value')) {
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
