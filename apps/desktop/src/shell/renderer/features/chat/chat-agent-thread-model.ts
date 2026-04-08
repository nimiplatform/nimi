import type {
  ConversationMessageViewModel,
  ConversationThreadSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalString,
  parseRequiredString,
} from '@renderer/bridge/runtime-bridge/shared';

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseOwnershipType(value: unknown): AgentLocalTargetSnapshot['ownershipType'] {
  const normalized = String(value || '').trim();
  if (normalized === 'MASTER_OWNED' || normalized === 'WORLD_OWNED') {
    return normalized;
  }
  return null;
}

function parseAgentFriendTarget(value: unknown): AgentLocalTargetSnapshot {
  const record = assertRecord(value, 'agent friend target is invalid');
  if (record.isAgent !== true) {
    throw new Error('agent friend target must set isAgent=true');
  }
  const world = parseOptionalJsonObject(record.world) ?? null;
  const agentProfile = parseOptionalJsonObject(record.agentProfile) ?? null;
  return {
    agentId: parseRequiredString(record.id, 'id', 'agent friend target'),
    displayName: parseRequiredString(record.displayName, 'displayName', 'agent friend target'),
    handle: parseRequiredString(record.handle, 'handle', 'agent friend target'),
    avatarUrl: parseOptionalString(record.avatarUrl) || null,
    worldId: parseOptionalString(record.worldId)
      || parseOptionalString(world?.id)
      || null,
    worldName: parseOptionalString(record.worldName)
      || parseOptionalString(world?.name)
      || null,
    bio: parseOptionalString(record.bio) || null,
    ownershipType: parseOwnershipType(record.ownershipType || agentProfile?.ownershipType),
  };
}

export function toAgentFriendTargetsFromSocialSnapshot(
  snapshot: { friends?: unknown[] } | null | undefined,
): AgentLocalTargetSnapshot[] {
  const friends = Array.isArray(snapshot?.friends) ? snapshot.friends : [];
  return friends
    .filter((item) => (parseOptionalJsonObject(item)?.isAgent === true))
    .map((item) => parseAgentFriendTarget(item))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function findAgentConversationThreadByAgentId(
  threads: readonly AgentLocalThreadSummary[],
  agentId: string | null | undefined,
): AgentLocalThreadSummary | null {
  const normalizedAgentId = normalizeText(agentId);
  if (!normalizedAgentId) {
    return null;
  }
  return threads.find((thread) => thread.agentId === normalizedAgentId) || null;
}

export function resolveAgentConversationActiveThreadId(input: {
  threads: readonly AgentLocalThreadSummary[];
  selectionThreadId: string | null | undefined;
  selectionAgentId: string | null | undefined;
  lastSelectedThreadId: string | null | undefined;
}): string | null {
  const normalizedSelectionThreadId = normalizeText(input.selectionThreadId);
  if (normalizedSelectionThreadId && input.threads.some((thread) => thread.id === normalizedSelectionThreadId)) {
    return normalizedSelectionThreadId;
  }
  const selectedAgentThread = findAgentConversationThreadByAgentId(input.threads, input.selectionAgentId);
  if (selectedAgentThread) {
    return selectedAgentThread.id;
  }
  const normalizedLastSelectedThreadId = normalizeText(input.lastSelectedThreadId);
  if (normalizedLastSelectedThreadId && input.threads.some((thread) => thread.id === normalizedLastSelectedThreadId)) {
    return normalizedLastSelectedThreadId;
  }
  return null;
}

export function toConversationThreadSummary(
  thread: AgentLocalThreadSummary,
): ConversationThreadSummary {
  return {
    id: thread.id,
    mode: 'agent',
    title: thread.title,
    previewText: '',
    createdAt: toIsoString(thread.updatedAtMs),
    updatedAt: toIsoString(thread.updatedAtMs),
    unreadCount: 0,
    status: thread.archivedAtMs == null ? 'active' : 'archived',
    pinned: false,
    targetId: thread.agentId,
    targetLabel: thread.targetSnapshot.displayName,
  };
}

export function toConversationMessageViewModel(
  message: AgentLocalMessageRecord,
): ConversationMessageViewModel {
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    text: message.contentText,
    createdAt: toIsoString(message.createdAtMs),
    updatedAt: toIsoString(message.updatedAtMs),
    status: message.status,
    error: message.error?.message || null,
    metadata: {
      kind: message.kind,
      traceId: message.traceId,
      parentMessageId: message.parentMessageId,
      reasoningText: message.reasoningText,
      mediaUrl: message.mediaUrl,
      mediaMimeType: message.mediaMimeType,
      artifactId: message.artifactId,
      mediaError: message.error?.message || null,
    },
  };
}

export function getAgentTargetDisplaySummary(target: AgentLocalTargetSnapshot): string {
  const ownership = target.ownershipType === 'MASTER_OWNED'
    ? 'My agent'
    : target.ownershipType === 'WORLD_OWNED'
      ? 'World agent'
      : null;
  return [target.worldName, ownership].filter(Boolean).join(' · ') || target.handle;
}
