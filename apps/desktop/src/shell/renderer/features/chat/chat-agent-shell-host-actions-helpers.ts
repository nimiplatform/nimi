import { uploadNimiRealmResourceFile } from '@nimiplatform/sdk/realm';
import {
  createNimiHostRuntimeAgentPresentationProfileSurface,
  createNimiRuntimeAgentConsumeClient,
  buildRuntimeAgentRequestContext,
  normalizeNimiRuntimeAgentPresentationRevision,
  normalizeNimiRuntimeAgentPresentationBackendKind,
} from '@nimiplatform/sdk/runtime';
import { asNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import { productionAppStore } from '@renderer/app-shell/providers/production-app-store';
import {
  getDesktopAppId,
  getDesktopHostRuntimeAgentClient,
  getDesktopRealm,
  getDesktopRuntime,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
  JsonObject,
} from '@renderer/bridge/runtime-bridge/types';
import {
  resolveNimiAIConfigRuntimeSchedulingTargetForCapability,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  bundleQueryKey,
  createAgentConversationCacheThreadId,
  normalizeText,
} from './chat-agent-shell-core';
import { createEmptyAgentThreadBundle } from './chat-agent-shell-bundle';
import { probeExecutionSchedulingGuard } from './chat-shared-execution-scheduling-guard';
import {
  clearAgentConversationAnchorBinding,
  getAgentConversationAnchorBinding,
  persistAgentConversationAnchorBinding,
  type AgentConversationAnchorBinding,
} from '@renderer/app-shell/providers/agent-conversation-anchor-binding-storage';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentChatUserAttachment } from './chat-agent-runtime-turn-types';
import type { UseAgentConversationHostActionsInput } from './chat-agent-shell-host-actions-types';

export function isAbortLikeSubmitError(error: unknown): boolean {
  const message = String((error instanceof Error ? error.message : error) || '').toLowerCase();
  return message.includes('aborted')
    || message.includes('cancelled')
    || message.includes('canceled')
    || message.includes('generation stopped');
}

function requireRuntimeSubjectUserId(): string {
  const subjectUserId = normalizeText((productionAppStore.getState().auth.user as Record<string, unknown> | null)?.id);
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

export function buildAgentConversationAnchorMetadata(target: AgentLocalTargetSnapshot): JsonObject {
  void target;
  return {
    surface: 'desktop-agent-chat',
  };
}

async function syncRuntimePresentationProfile(input: {
  target: AgentLocalTargetSnapshot;
  context: {
    appId: string;
    subjectUserId: string;
    ownerUserId: string;
    runtimeSourceRef: string;
    localAgentRef: string;
  };
}): Promise<void> {
  const profile = input.target.presentationProfile;
  const backendKind = profile
    ? normalizeNimiRuntimeAgentPresentationBackendKind(profile.backendKind)
    : null;
  const avatarAssetRef = normalizeText(profile?.avatarAssetRef);
  if (!profile || !backendKind || !avatarAssetRef) {
    return;
  }
  const runtime = getDesktopHostRuntimeAgentClient();
  const surface = createNimiHostRuntimeAgentPresentationProfileSurface({
    getRuntime: () => runtime,
    getSubjectUserId: () => input.context.subjectUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  const current = await withDesktopRuntimeProtectedScopes(
    ['runtime.agent.read'],
    (callOptions) => runtime.agent.getAgent({
      context: buildRuntimeAgentRequestContext({
        runtimeAppId: input.context.appId,
        subjectUserId: input.context.subjectUserId,
        ownerUserId: input.context.ownerUserId,
        runtimeSourceRef: input.context.runtimeSourceRef,
        localAgentRef: input.context.localAgentRef,
      }),
      agentId: input.context.localAgentRef,
    }, callOptions),
  );
  const expectedRevision = normalizeNimiRuntimeAgentPresentationRevision(
    current.agent?.presentationProfileRevision,
  );
  if (expectedRevision === null) {
    throw new Error('Runtime Agent presentation profile revision is unavailable.');
  }
  await surface.setPresentationProfile({
    localAgentRef: input.context.localAgentRef,
    ownerUserId: input.context.ownerUserId,
    runtimeSourceRef: input.context.runtimeSourceRef,
  }, profile, expectedRevision);
}

export async function ensureRuntimeAgentExists(target: AgentLocalTargetSnapshot): Promise<void> {
  const runtime = getDesktopHostRuntimeAgentClient();
  const subjectUserId = requireRuntimeSubjectUserId();
  const context = {
    appId: runtime.appId,
    subjectUserId,
    ownerUserId: target.ownerUserId,
    runtimeSourceRef: target.runtimeSourceRef,
    localAgentRef: target.localAgentRef,
  };
  const response = await withDesktopRuntimeProtectedScopes(
    ['runtime.agent.read'],
    (callOptions) => runtime.agent.getAgent({
      context: buildRuntimeAgentRequestContext({
        runtimeAppId: context.appId,
        subjectUserId,
        ownerUserId: context.ownerUserId,
        runtimeSourceRef: context.runtimeSourceRef,
        localAgentRef: context.localAgentRef,
      }),
      agentId: context.localAgentRef,
    }, callOptions),
  );
  const returnedLocalAgentRef = normalizeText(response.agent?.localAgentRef || response.agent?.agentId);
  if (returnedLocalAgentRef !== context.localAgentRef) {
    throw new Error('Runtime LocalAgent inventory did not return the selected opaque localAgentRef.');
  }
  await syncRuntimePresentationProfile({ target, context });
}

export async function assertAgentSubmitSchedulingAllowed(input: {
  aiConfig: UseAgentConversationHostActionsInput['aiConfig'];
  t: UseAgentConversationHostActionsInput['t'];
}): Promise<void> {
  const target = resolveNimiAIConfigRuntimeSchedulingTargetForCapability(input.aiConfig, 'text.generate');
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

async function openConversationAnchorForTarget(
  target: AgentLocalTargetSnapshot,
): Promise<{
  conversationAnchorId: string;
  threadId: string;
}> {
  const client = createNimiRuntimeAgentConsumeClient({
    runtime: getDesktopRuntime(),
    runtimeAppId: getDesktopAppId(),
  });
  await ensureRuntimeAgentExists(target);
  const snapshot = await client.anchors.open({
    localAgentRef: target.localAgentRef,
    ownerUserId: target.ownerUserId,
    runtimeSourceRef: target.runtimeSourceRef,
    metadata: buildAgentConversationAnchorMetadata(target),
  }).catch((error) => {
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
  const threadId = await readConversationThreadId({
    client,
    target,
    conversationAnchorId,
  });
  return { conversationAnchorId, threadId };
}

async function readConversationThreadId(input: {
  client: ReturnType<typeof createNimiRuntimeAgentConsumeClient>;
  target: AgentLocalTargetSnapshot;
  conversationAnchorId: string;
}): Promise<string> {
  const snapshot = await input.client.turns.getSessionSnapshot({
    localAgentRef: input.target.localAgentRef,
    ownerUserId: input.target.ownerUserId,
    runtimeSourceRef: input.target.runtimeSourceRef,
    conversationAnchorId: input.conversationAnchorId,
  });
  const threadId = normalizeText(snapshot.threadId);
  if (!threadId) {
    throw new Error('Runtime conversation session snapshot returned no threadId.');
  }
  return threadId;
}

async function ensureConversationAnchorBindingUpstream(input: {
  target: AgentLocalTargetSnapshot;
  binding: AgentConversationAnchorBinding;
}): Promise<AgentConversationAnchorBinding | null> {
  const client = createNimiRuntimeAgentConsumeClient({
    runtime: getDesktopRuntime(),
    runtimeAppId: getDesktopAppId(),
  });
  await ensureRuntimeAgentExists(input.target);
  try {
    await client.anchors.getSnapshot({
      localAgentRef: input.target.localAgentRef,
      ownerUserId: input.target.ownerUserId,
      runtimeSourceRef: input.target.runtimeSourceRef,
      conversationAnchorId: input.binding.conversationAnchorId,
    });
    const threadId = await readConversationThreadId({
      client,
      target: input.target,
      conversationAnchorId: input.binding.conversationAnchorId,
    });
    if (threadId === input.binding.threadId) {
      return input.binding;
    }
    return persistAgentConversationAnchorBinding({
      ...input.binding,
      threadId,
      updatedAtMs: Date.now(),
    });
  } catch (error) {
    if (!isRecoverableRuntimeAnchorError(error)) {
      const normalized = normalizeRuntimeError(error, 'get_runtime_agent_anchor_snapshot');
      const reasonCode = normalizeText(normalized.reasonCode) || 'RUNTIME_CALL_FAILED';
      throw new Error(
        `get runtime agent anchor snapshot failed: ${normalized.message} [${reasonCode}]`,
        { cause: error },
      );
    }
    clearAgentConversationAnchorBinding(input.target.localAgentRef);
    return null;
  }
}

export async function createThreadForTarget(
  input: UseAgentConversationHostActionsInput,
  target: AgentLocalTargetSnapshot,
): Promise<AgentLocalThreadSummary> {
  const timestampMs = Date.now();
  const thread: AgentLocalThreadRecord = {
    id: createAgentConversationCacheThreadId(target.localAgentRef),
    ownerUserId: target.ownerUserId,
    runtimeSourceRef: target.runtimeSourceRef,
    localAgentRef: target.localAgentRef,
    title: target.displayName,
    createdAtMs: timestampMs,
    updatedAtMs: timestampMs,
    lastMessageAtMs: null,
    targetSnapshot: target,
  };
  input.queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyAgentThreadBundle(thread));
  input.currentComposerTextRef.current = '';
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
  let anchorBinding: AgentConversationAnchorBinding | null = null;
  const existingBinding = getAgentConversationAnchorBinding(input.target.localAgentRef);
  if (existingBinding) {
    if (existingBinding.localAgentRef !== input.target.localAgentRef) {
      throw new Error('agent thread anchor binding does not match selected agent');
    }
    const runtimeBinding = await ensureConversationAnchorBindingUpstream({
      target: input.target,
      binding: existingBinding,
    });
    if (runtimeBinding) {
      anchorBinding = runtimeBinding;
    }
  }
  if (!anchorBinding) {
    const { conversationAnchorId, threadId } = await openConversationAnchorForTarget(input.target);
    anchorBinding = persistAgentConversationAnchorBinding({
      ownerUserId: input.target.ownerUserId,
      runtimeSourceRef: input.target.runtimeSourceRef,
      localAgentRef: input.target.localAgentRef,
      conversationAnchorId,
      threadId,
      updatedAtMs: Date.now(),
    });
  }
  const ensuredThread = input.thread ?? await createThreadForTarget(input.input, input.target);
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
  const uploaded = await uploadNimiRealmResourceFile(getDesktopRealm(), {
    kind: 'image',
    file: attachment.file,
    failureMessage: input.t('Chat.agentAttachmentUploadFailed', {
      defaultValue: 'Failed to upload image attachment.',
    }),
    transportMode: 'multipart_post_then_binary_put',
  });
  const url = normalizeText(uploaded.resource.url);
  if (!url) {
    throw new Error(input.t('Chat.agentAttachmentUploadFailed', {
      defaultValue: 'Failed to upload image attachment.',
    }));
  }
  return {
    kind: 'image',
    url,
    mimeType: normalizeText(uploaded.resource.mimeType) || attachment.file.type || null,
    name: attachment.name,
    resourceId: normalizeText(uploaded.resource.id) || normalizeText(uploaded.resourceId) || null,
  };
}
