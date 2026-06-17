import { uploadNimiRealmResourceFile } from '@nimiplatform/sdk/realm';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiHostRuntimeAgentPresentationProfileSurface,
  createNimiRuntimeAgentConsumeClient,
  normalizeNimiRuntimeAgentPresentationBackendKind,
} from '@nimiplatform/sdk/runtime';
import { asNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
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

export function buildAgentConversationAnchorMetadata(target: AgentLocalTargetSnapshot): JsonObject {
  const realmProfileContext: JsonObject = {
    displayName: normalizeText(target.displayName),
    handle: normalizeText(target.handle),
    realmAgentId: normalizeText(target.realmAgentId),
    localAgentRef: normalizeText(target.localAgentRef),
  };
  const optionalFields: Array<[string, string | null | undefined]> = [
    ['avatarUrl', target.avatarUrl],
    ['defaultVoiceReference', target.defaultVoiceReference],
    ['worldId', target.worldId],
    ['worldName', target.worldName],
    ['description', target.bio],
    ['greeting', target.greeting],
    ['ownershipType', target.ownershipType],
  ];
  for (const [key, value] of optionalFields) {
    const normalized = normalizeText(value);
    if (normalized) {
      realmProfileContext[key] = normalized;
    }
  }
  if (target.avatarAutoplay === true) {
    realmProfileContext.avatarAutoplay = true;
  }
  const speechSynthesis = target.speechSynthesis ?? null;
  if (speechSynthesis) {
    const speechModelId = normalizeText(speechSynthesis.modelId);
    const speechRoutePolicy = normalizeText(speechSynthesis.routePolicy);
    if (speechModelId && (speechRoutePolicy === 'local' || speechRoutePolicy === 'cloud')) {
      realmProfileContext.speechModelId = speechModelId;
      realmProfileContext.speechRoutePolicy = speechRoutePolicy;
    }
  }
  if (target.ownershipType === 'WORLD_OWNED' && normalizeText(target.worldId).startsWith('cbdb-')) {
    realmProfileContext.ownerScope = 'forge-imported-system';
    realmProfileContext.sourceProfile = 'cbdb-historical';
  }
  const ownerSettingsProjection = target.ownerSettingsProjection ?? null;
  if (ownerSettingsProjection) {
    if (typeof ownerSettingsProjection.agentRuleVersion === 'number') {
      realmProfileContext.agentRuleVersion = ownerSettingsProjection.agentRuleVersion;
    }
    const communicationStyle = normalizeText(ownerSettingsProjection.communicationStyle);
    if (communicationStyle) {
      realmProfileContext.communicationStyle = communicationStyle;
    }
    const selectedFields = ownerSettingsProjection.selectedOwnerSettingFields
      .map((field) => normalizeText(field))
      .filter(Boolean);
    if (selectedFields.length > 0) {
      realmProfileContext.selectedOwnerSettingFields = selectedFields;
    }
  }
  return {
    surface: 'desktop-agent-chat',
    realmProfileContext,
  };
}

async function syncRuntimePresentationProfile(input: {
  target: AgentLocalTargetSnapshot;
  context: {
    appId: string;
    subjectUserId: string;
    ownerUserId: string;
    realmAgentId: string;
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
  await surface.setPresentationProfile(input.target.localAgentRef, profile);
}

export async function ensureRuntimeAgentExists(target: AgentLocalTargetSnapshot): Promise<void> {
  const runtime = getDesktopHostRuntimeAgentClient();
  const subjectUserId = requireRuntimeSubjectUserId();
  const context = {
    appId: runtime.appId,
    subjectUserId,
    ownerUserId: target.ownerUserId,
    realmAgentId: target.realmAgentId,
    localAgentRef: target.localAgentRef,
  };
  const lifecycleSurface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => runtime,
    getSubjectUserId: () => subjectUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  await lifecycleSurface.ensureLocalAgentInitialized({
    localAgentRef: target.localAgentRef,
    ownerUserId: target.ownerUserId,
    realmAgentId: target.realmAgentId,
    displayName: target.displayName || target.realmAgentId,
    worldId: normalizeText(target.worldId),
  });
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
): Promise<string> {
  const client = createNimiRuntimeAgentConsumeClient({
    runtime: getDesktopRuntime(),
    runtimeAppId: getDesktopAppId(),
  });
  await ensureRuntimeAgentExists(target);
  const snapshot = await client.anchors.open({
    localAgentRef: target.localAgentRef,
    ownerUserId: target.ownerUserId,
    realmAgentId: target.realmAgentId,
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
  return conversationAnchorId;
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
      realmAgentId: input.target.realmAgentId,
      conversationAnchorId: input.binding.conversationAnchorId,
    });
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
    realmAgentId: target.realmAgentId,
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
    const conversationAnchorId = await openConversationAnchorForTarget(input.target);
    anchorBinding = persistAgentConversationAnchorBinding({
      ownerUserId: input.target.ownerUserId,
      realmAgentId: input.target.realmAgentId,
      localAgentRef: input.target.localAgentRef,
      conversationAnchorId,
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
