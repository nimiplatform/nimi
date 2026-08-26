import {
  isNimiRuntimeAgentCanceledError,
} from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import {
  bundleQueryKey,
  createAgentConversationCacheThreadId,
  normalizeText,
} from './chat-agent-shell-core';
import { createEmptyAgentThreadBundle } from './chat-agent-shell-bundle';
import { encodeBytesAsDataUrl } from './chat-agent-runtime-shared';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentChatUserAttachment } from './chat-agent-runtime-turn-types';
import type { AgentUserProjectionAttachment } from './chat-agent-user-projection';
import type { UseAgentConversationHostActionsInput } from './chat-agent-shell-host-actions-types';
import { getDesktopConversationClient } from '../../infra/sdk/desktop-nimi-client-session.js';

export function isTypedSubmitCancellationError(error: unknown): boolean {
  return isNimiRuntimeAgentCanceledError(error);
}

function requireRuntimeSubjectUserId(value: string): string {
  const subjectUserId = normalizeText(value);
  if (!subjectUserId) {
    throw new Error('desktop agent chat requires authenticated subject user id for runtime.agent');
  }
  return subjectUserId;
}

export async function ensureRuntimeAgentExists(
  target: AgentLocalTargetSnapshot,
  sdk: DesktopRendererSdkPort,
  subjectUserIdInput: string,
): Promise<void> {
  const runtime = sdk.hostRuntimeAgent();
  const subjectUserId = requireRuntimeSubjectUserId(subjectUserIdInput);
  const localAgentRef = normalizeText(target.localAgentRef);
  if (!localAgentRef) {
    throw new Error('Runtime presentation lookup requires a private localAgentRef sideband.');
  }
  const context = {
    appId: runtime.appId,
    subjectUserId,
    ownerUserId: target.ownerUserId,
    runtimeSourceRef: target.runtimeSourceRef,
    localAgentRef,
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
): Promise<{
  conversationAnchorId: string;
  threadId: string;
}> {
  const agentHandle = normalizeText(target.agentHandle);
  if (!agentHandle) {
    throw new Error('Desktop canonical Agent Conversation requires agentHandle.');
  }
  const opened = await getDesktopConversationClient().open({
    agentHandle: agentHandle as import('@nimiplatform/sdk/app').NimiLocalAppAgentHandle,
  });
  return {
    conversationAnchorId: opened.conversationAnchorId,
    threadId: opened.conversationAnchorId,
  };
}

type CanonicalConversationBinding = {
  agentHandle: string;
  conversationAnchorId: string;
  threadId: string;
  updatedAtMs: number;
};

export async function createThreadForTarget(
  input: UseAgentConversationHostActionsInput,
  target: AgentLocalTargetSnapshot,
): Promise<AgentLocalThreadSummary> {
  const timestampMs = input.now();
  const conversationAnchorId = normalizeText(target.conversationAnchorId);
  if (!conversationAnchorId) throw new Error('Canonical Agent target requires Conversation anchor.');
  const thread: AgentLocalThreadRecord = {
    id: createAgentConversationCacheThreadId(conversationAnchorId),
    ...(target.ownerUserId ? { ownerUserId: target.ownerUserId } : {}),
    ...(target.runtimeSourceRef ? { runtimeSourceRef: target.runtimeSourceRef } : {}),
    ...(target.localAgentRef ? { localAgentRef: target.localAgentRef } : {}),
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
  anchorBinding: CanonicalConversationBinding;
}> {
  const agentHandle = normalizeText(input.target.agentHandle);
  if (!agentHandle) throw new Error('Canonical Agent target requires agentHandle.');
  const { conversationAnchorId, threadId } = await openConversationAnchorForTarget(input.target);
  const canonicalTarget = {
    ...input.target,
    agentHandle,
    conversationAnchorId,
  };
  const canonicalThreadId = createAgentConversationCacheThreadId(conversationAnchorId);
  const ensuredThread = input.thread?.id === canonicalThreadId
    ? { ...input.thread, targetSnapshot: canonicalTarget }
    : await createThreadForTarget(input.input, canonicalTarget);
  return {
    thread: ensuredThread,
    anchorBinding: {
      agentHandle,
      conversationAnchorId,
      threadId,
      updatedAtMs: input.input.now(),
    },
  };
}

export async function uploadPendingAttachment(
  input: UseAgentConversationHostActionsInput,
  attachment: PendingAttachment,
	target: AgentLocalTargetSnapshot,
	conversationAnchorId: string,
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
	const mimeType = attachment.file.type;
	if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) {
	  throw new Error(uploadFailureMessage);
	}
	const agentHandle = normalizeText(target.agentHandle) as import('@nimiplatform/sdk/app').NimiLocalAppAgentHandle;
	const uploaded = await getDesktopConversationClient().uploadAttachment({
	agentHandle,
	conversationAnchorId,
	mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
	displayName: attachment.name,
	bytes,
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
	target: AgentLocalTargetSnapshot,
	conversationAnchorId: string,
): Promise<AgentUserProjectionAttachment> {
	const artifact = await getDesktopConversationClient().readArtifact({
	agentHandle: normalizeText(target.agentHandle) as import('@nimiplatform/sdk/app').NimiLocalAppAgentHandle,
	conversationAnchorId,
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
