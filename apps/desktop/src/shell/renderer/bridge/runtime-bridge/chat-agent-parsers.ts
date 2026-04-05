import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type {
  AgentLocalCreateMessageInput,
  AgentLocalCreateThreadInput,
  AgentLocalDraftRecord,
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalMessageRole,
  AgentLocalMessageStatus,
  AgentLocalPutDraftInput,
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
  AgentLocalUpdateMessageInput,
  AgentLocalUpdateThreadMetadataInput,
} from './chat-agent-types.js';

function parseFiniteInteger(value: unknown, fieldName: string, errorPrefix: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`${errorPrefix}: ${fieldName} must be an integer`);
  }
  return numeric;
}

function parseNullableFiniteInteger(value: unknown, fieldName: string, errorPrefix: string): number | null {
  if (value == null) {
    return null;
  }
  return parseFiniteInteger(value, fieldName, errorPrefix);
}

function parseMessageRole(value: unknown, errorPrefix: string): AgentLocalMessageRole {
  const normalized = String(value || '').trim();
  if (normalized === 'system' || normalized === 'user' || normalized === 'assistant') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: role is invalid`);
}

function parseMessageStatus(value: unknown, errorPrefix: string): AgentLocalMessageStatus {
  const normalized = String(value || '').trim();
  if (normalized === 'pending' || normalized === 'complete' || normalized === 'error') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: status is invalid`);
}

function parseOwnershipType(
  value: unknown,
  errorPrefix: string,
): AgentLocalTargetSnapshot['ownershipType'] {
  const normalized = parseOptionalString(value) || null;
  if (!normalized) {
    return null;
  }
  if (normalized === 'MASTER_OWNED' || normalized === 'WORLD_OWNED') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: ownershipType is invalid`);
}

export function parseAgentLocalTargetSnapshot(value: unknown): AgentLocalTargetSnapshot {
  const record = assertRecord(value, 'chat_agent target snapshot is invalid');
  return {
    agentId: parseRequiredString(record.agentId, 'agentId', 'chat_agent target snapshot'),
    displayName: parseRequiredString(record.displayName, 'displayName', 'chat_agent target snapshot'),
    handle: parseRequiredString(record.handle, 'handle', 'chat_agent target snapshot'),
    avatarUrl: parseOptionalString(record.avatarUrl) || null,
    worldId: parseOptionalString(record.worldId) || null,
    worldName: parseOptionalString(record.worldName) || null,
    bio: parseOptionalString(record.bio) || null,
    ownershipType: parseOwnershipType(record.ownershipType, 'chat_agent target snapshot'),
  };
}

export function parseAgentLocalThreadSummary(value: unknown): AgentLocalThreadSummary {
  const record = assertRecord(value, 'chat_agent thread summary is invalid');
  const agentId = parseRequiredString(record.agentId, 'agentId', 'chat_agent thread summary');
  const targetSnapshot = parseAgentLocalTargetSnapshot(record.targetSnapshot);
  if (targetSnapshot.agentId !== agentId) {
    throw new Error('chat_agent thread summary: targetSnapshot.agentId must match agentId');
  }
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent thread summary'),
    agentId,
    title: parseRequiredString(record.title, 'title', 'chat_agent thread summary'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent thread summary'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_agent thread summary'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_agent thread summary'),
    targetSnapshot,
  };
}

export function parseAgentLocalThreadSummaries(value: unknown): AgentLocalThreadSummary[] {
  if (!Array.isArray(value)) {
    throw new Error('chat_agent list_threads returned non-array payload');
  }
  return value.map((item) => parseAgentLocalThreadSummary(item));
}

export function parseAgentLocalThreadRecord(value: unknown): AgentLocalThreadRecord {
  const record = assertRecord(value, 'chat_agent thread record is invalid');
  return {
    ...parseAgentLocalThreadSummary(record),
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent thread record'),
  };
}

export function parseAgentLocalMessageError(value: unknown): AgentLocalMessageError {
  const record = assertRecord(value, 'chat_agent message error is invalid');
  return {
    code: parseOptionalString(record.code),
    message: parseRequiredString(record.message, 'message', 'chat_agent message error'),
  };
}

export function parseAgentLocalMessageRecord(value: unknown): AgentLocalMessageRecord {
  const record = assertRecord(value, 'chat_agent message record is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent message record'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent message record'),
    role: parseMessageRole(record.role, 'chat_agent message record'),
    status: parseMessageStatus(record.status, 'chat_agent message record'),
    contentText: String(record.contentText ?? ''),
    reasoningText: parseOptionalString(record.reasoningText) || null,
    error: record.error == null ? null : parseAgentLocalMessageError(record.error),
    traceId: parseOptionalString(record.traceId) || null,
    parentMessageId: parseOptionalString(record.parentMessageId) || null,
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent message record'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent message record'),
  };
}

export function parseAgentLocalDraftRecord(value: unknown): AgentLocalDraftRecord {
  const record = assertRecord(value, 'chat_agent draft record is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent draft record'),
    text: String(record.text ?? ''),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent draft record'),
  };
}

export function parseAgentLocalThreadBundle(value: unknown): AgentLocalThreadBundle | null {
  if (value == null) {
    return null;
  }
  const record = assertRecord(value, 'chat_agent thread bundle is invalid');
  return {
    thread: parseAgentLocalThreadRecord(record.thread),
    messages: Array.isArray(record.messages)
      ? record.messages.map((item) => parseAgentLocalMessageRecord(item))
      : (() => { throw new Error('chat_agent thread bundle.messages must be an array'); })(),
    draft: record.draft == null ? null : parseAgentLocalDraftRecord(record.draft),
  };
}

export function parseAgentLocalCreateThreadInput(value: unknown): AgentLocalCreateThreadInput {
  const record = assertRecord(value, 'chat_agent create_thread payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent create_thread payload'),
    agentId: parseRequiredString(record.agentId, 'agentId', 'chat_agent create_thread payload'),
    title: parseRequiredString(record.title, 'title', 'chat_agent create_thread payload'),
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent create_thread payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent create_thread payload'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_agent create_thread payload'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_agent create_thread payload'),
    targetSnapshot: parseAgentLocalTargetSnapshot(record.targetSnapshot),
  };
}

export function parseAgentLocalUpdateThreadMetadataInput(value: unknown): AgentLocalUpdateThreadMetadataInput {
  const record = assertRecord(value, 'chat_agent update_thread_metadata payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent update_thread_metadata payload'),
    title: parseRequiredString(record.title, 'title', 'chat_agent update_thread_metadata payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent update_thread_metadata payload'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_agent update_thread_metadata payload'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_agent update_thread_metadata payload'),
    targetSnapshot: parseAgentLocalTargetSnapshot(record.targetSnapshot),
  };
}

export function parseAgentLocalCreateMessageInput(value: unknown): AgentLocalCreateMessageInput {
  const record = assertRecord(value, 'chat_agent create_message payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent create_message payload'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent create_message payload'),
    role: parseMessageRole(record.role, 'chat_agent create_message payload'),
    status: parseMessageStatus(record.status, 'chat_agent create_message payload'),
    contentText: String(record.contentText ?? ''),
    reasoningText: parseOptionalString(record.reasoningText) || null,
    error: record.error == null ? null : parseAgentLocalMessageError(record.error),
    traceId: parseOptionalString(record.traceId) || null,
    parentMessageId: parseOptionalString(record.parentMessageId) || null,
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent create_message payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent create_message payload'),
  };
}

export function parseAgentLocalUpdateMessageInput(value: unknown): AgentLocalUpdateMessageInput {
  const record = assertRecord(value, 'chat_agent update_message payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent update_message payload'),
    status: parseMessageStatus(record.status, 'chat_agent update_message payload'),
    contentText: String(record.contentText ?? ''),
    reasoningText: parseOptionalString(record.reasoningText) || null,
    error: record.error == null ? null : parseAgentLocalMessageError(record.error),
    traceId: parseOptionalString(record.traceId) || null,
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent update_message payload'),
  };
}

export function parseAgentLocalPutDraftInput(value: unknown): AgentLocalPutDraftInput {
  const record = assertRecord(value, 'chat_agent put_draft payload is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent put_draft payload'),
    text: String(record.text ?? ''),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent put_draft payload'),
  };
}
