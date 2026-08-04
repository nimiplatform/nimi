import {
  createNimiRuntimeAgentConsumeClient,
} from '@nimiplatform/sdk/runtime';
import { asNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
  JsonObject,
} from '../../bridge/runtime-bridge/types';
import {
  bundleQueryKey,
  createAgentConversationCacheThreadId,
  normalizeText,
} from './chat-agent-shell-core';
import { createEmptyAgentThreadBundle } from './chat-agent-shell-bundle';
import { encodeBytesAsDataUrl } from './chat-agent-runtime-shared';
import type { AgentConversationAnchorBinding } from '../../app-shell/providers/agent-conversation-anchor-binding-storage';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentChatUserAttachment } from './chat-agent-runtime-turn-types';
import type { AgentUserProjectionAttachment } from './chat-agent-user-projection';
import type { UseAgentConversationHostActionsInput } from './chat-agent-shell-host-actions-types';

export function isAbortLikeSubmitError(error: unknown): boolean {
  const message = String((error instanceof Error ? error.message : error) || '').toLowerCase();
  return message.includes('aborted')
    || message.includes('cancelled')
    || message.includes('canceled')
    || message.includes('generation stopped');
}

function requireRuntimeSubjectUserId(value: string): string {
  const subjectUserId = normalizeText(value);
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

export async function ensureRuntimeAgentExists(
  target: AgentLocalTargetSnapshot,
  sdk: DesktopRendererSdkPort,
  subjectUserIdInput: string,
): Promise<void> {
  const runtime = sdk.hostRuntimeAgent();
  const subjectUserId = requireRuntimeSubjectUserId(subjectUserIdInput);
  const context = {
    appId: runtime.appId,
    subjectUserId,
    ownerUserId: target.ownerUserId,
    runtimeSourceRef: target.runtimeSourceRef,
    localAgentRef: target.localAgentRef,
  };
  // Protected desktop GetAgent forbids caller-built identity selectors: the
  // Runtime injects the account principal and checks Agent ownership itself.
  const response = await sdk.withRuntimeProtectedScopes(
    ['runtime.agent.read'],
    (callOptions) => runtime.agent.getAgent({
      agentId: context.localAgentRef,
    }, callOptions),
  );
  const returnedLocalAgentRef = normalizeText(response.agent?.localAgentRef);
  if (returnedLocalAgentRef !== context.localAgentRef) {
    throw new Error('Runtime LocalAgent inventory did not return the selected opaque localAgentRef.');
  }
}

async function openConversationAnchorForTarget(
  target: AgentLocalTargetSnapshot,
  sdk: DesktopRendererSdkPort,
  subjectUserId: string,
): Promise<{
  conversationAnchorId: string;
  threadId: string;
}> {
  const client = createNimiRuntimeAgentConsumeClient({
    runtime: sdk.accountProduct(),
    runtimeAppId: sdk.appId(),
  });
  await ensureRuntimeAgentExists(target, sdk, subjectUserId);
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
  now: () => number;
  anchorBindings: UseAgentConversationHostActionsInput['anchorBindings'];
  sdk: DesktopRendererSdkPort;
  subjectUserId: string;
}): Promise<AgentConversationAnchorBinding | null> {
  const client = createNimiRuntimeAgentConsumeClient({
    runtime: input.sdk.accountProduct(),
    runtimeAppId: input.sdk.appId(),
  });
  await ensureRuntimeAgentExists(input.target, input.sdk, input.subjectUserId);
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
    return input.anchorBindings.persist({
      ...input.binding,
      threadId,
      updatedAtMs: input.now(),
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
    input.anchorBindings.clear(input.target.localAgentRef);
    return null;
  }
}

export async function createThreadForTarget(
  input: UseAgentConversationHostActionsInput,
  target: AgentLocalTargetSnapshot,
): Promise<AgentLocalThreadSummary> {
  const timestampMs = input.now();
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
  const existingBinding = input.input.anchorBindings.get(input.target.localAgentRef);
  if (existingBinding) {
    if (existingBinding.localAgentRef !== input.target.localAgentRef) {
      throw new Error('agent thread anchor binding does not match selected agent');
    }
    const runtimeBinding = await ensureConversationAnchorBindingUpstream({
      target: input.target,
      binding: existingBinding,
      now: input.input.now,
      anchorBindings: input.input.anchorBindings,
      sdk: input.input.sdk,
      subjectUserId: input.input.subjectUserId,
    });
    if (runtimeBinding) {
      anchorBinding = runtimeBinding;
    }
  }
  if (!anchorBinding) {
    const { conversationAnchorId, threadId } = await openConversationAnchorForTarget(
      input.target,
      input.input.sdk,
      input.input.subjectUserId,
    );
    anchorBinding = input.input.anchorBindings.persist({
      ownerUserId: input.target.ownerUserId,
      runtimeSourceRef: input.target.runtimeSourceRef,
      localAgentRef: input.target.localAgentRef,
      conversationAnchorId,
      threadId,
      updatedAtMs: input.input.now(),
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
  const uploadFailureMessage = input.t('Chat.agentAttachmentUploadFailed', {
    defaultValue: 'Failed to upload image attachment.',
  });
  const bytes = new Uint8Array(await attachment.file.arrayBuffer());
  const uploaded = await input.sdk.accountProduct().artifacts.putArtifact({
    mimeType: attachment.file.type || 'application/octet-stream',
    displayName: attachment.name,
    data: bytes,
  }).catch((error: unknown) => {
    throw new Error(uploadFailureMessage, { cause: error });
  });
  const artifactId = normalizeText(uploaded.artifactId);
  if (!artifactId) {
    throw new Error(uploadFailureMessage);
  }
  return {
    kind: 'image',
    artifactId,
    mimeType: normalizeText(attachment.file.type) || null,
    name: attachment.name,
  };
}

export async function resolveUploadedAttachmentProjection(
  input: UseAgentConversationHostActionsInput,
  attachment: AgentChatUserAttachment,
): Promise<AgentUserProjectionAttachment> {
  const artifact = await input.sdk.accountProduct().artifacts.readArtifactBytes({
    artifactId: attachment.artifactId,
  }).catch((error: unknown) => {
    throw new Error(input.t('Chat.agentAttachmentUploadFailed', {
      defaultValue: 'Failed to upload image attachment.',
    }), { cause: error });
  });
  const mimeType = normalizeText(artifact.mimeType) || attachment.mimeType || 'application/octet-stream';
  return {
    kind: 'image',
    mediaUrl: encodeBytesAsDataUrl(mimeType, artifact.bytes),
    mediaMimeType: attachment.mimeType,
    artifactId: attachment.artifactId,
  };
}
