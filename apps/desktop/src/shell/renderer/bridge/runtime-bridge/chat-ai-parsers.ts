import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type {
  ChatAiAttachment,
  ChatAiCreateMessageInput,
  ChatAiCreateThreadInput,
  ChatAiDraftRecord,
  ChatAiMessageContent,
  ChatAiMessageError,
  ChatAiMessagePart,
  ChatAiMessageRecord,
  ChatAiMessageRole,
  ChatAiMessageStatus,
  ChatAiPutDraftInput,
  ChatAiRouteKind,
  ChatAiRouteSnapshot,
  ChatAiThreadBundle,
  ChatAiThreadRecord,
  ChatAiThreadSummary,
  ChatAiToolCall,
  ChatAiToolCallError,
  ChatAiUpdateMessageInput,
  ChatAiUpdateThreadMetadataInput,
} from './chat-ai-types.js';
import type { JsonObject, JsonValue } from './shared.js';

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

function parseJsonValue(value: unknown, errorPrefix: string): JsonValue {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => parseJsonValue(item, `${errorPrefix}[${index}]`));
  }
  if (typeof value === 'object') {
    const record = assertRecord(value, `${errorPrefix} must be a JSON object`);
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, parseJsonValue(item, `${errorPrefix}.${key}`)]),
    );
  }
  throw new Error(`${errorPrefix} must be valid JSON`);
}

function parseJsonObject(value: unknown, fieldName: string, errorPrefix: string): JsonObject {
  const record = assertRecord(value, `${errorPrefix}: ${fieldName} must be an object`);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, parseJsonValue(item, `${errorPrefix}: ${fieldName}.${key}`)]),
  );
}

function parseRouteKind(value: unknown, errorPrefix: string): ChatAiRouteKind {
  const normalized = String(value || '').trim();
  if (normalized === 'local' || normalized === 'cloud') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: routeKind is invalid`);
}

function parseMessageRole(value: unknown, errorPrefix: string): ChatAiMessageRole {
  const normalized = String(value || '').trim();
  if (normalized === 'system' || normalized === 'user' || normalized === 'assistant' || normalized === 'tool') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: role is invalid`);
}

function parseMessageStatus(value: unknown, errorPrefix: string): ChatAiMessageStatus {
  const normalized = String(value || '').trim();
  if (
    normalized === 'pending'
    || normalized === 'streaming'
    || normalized === 'complete'
    || normalized === 'error'
    || normalized === 'canceled'
  ) {
    return normalized;
  }
  throw new Error(`${errorPrefix}: status is invalid`);
}

export function parseChatAiRouteSnapshot(value: unknown): ChatAiRouteSnapshot {
  const record = assertRecord(value, 'chat_ai routeSnapshot is invalid');
  const routeKind = parseRouteKind(record.routeKind, 'chat_ai routeSnapshot');
  const connectorId = parseOptionalString(record.connectorId) || null;
  const provider = parseOptionalString(record.provider) || null;
  const modelId = parseOptionalString(record.modelId) || null;
  const routeBinding = record.routeBinding == null
    ? null
    : parseJsonObject(record.routeBinding, 'routeBinding', 'chat_ai routeSnapshot');
  if (routeKind === 'local' && (connectorId || provider || modelId)) {
    throw new Error('chat_ai routeSnapshot.local must not include connectorId/provider/modelId');
  }
  if (routeKind === 'cloud' && (!connectorId || !provider)) {
    throw new Error('chat_ai routeSnapshot.cloud requires connectorId and provider');
  }
  return {
    routeKind,
    connectorId,
    provider,
    modelId,
    routeBinding,
  };
}

export function parseChatAiAttachment(value: unknown, errorPrefix = 'chat_ai attachment'): ChatAiAttachment {
  const record = assertRecord(value, `${errorPrefix} is invalid`);
  return {
    attachmentId: parseRequiredString(record.attachmentId, 'attachmentId', errorPrefix),
    name: parseRequiredString(record.name, 'name', errorPrefix),
    mimeType: parseRequiredString(record.mimeType, 'mimeType', errorPrefix),
    sizeBytes: parseFiniteInteger(record.sizeBytes, 'sizeBytes', errorPrefix),
  };
}

function parseChatAiToolCallError(value: unknown, errorPrefix: string): ChatAiToolCallError {
  const record = assertRecord(value, `${errorPrefix} is invalid`);
  return {
    code: parseOptionalString(record.code),
    message: parseRequiredString(record.message, 'message', errorPrefix),
  };
}

function parseChatAiToolCall(value: unknown, errorPrefix: string): ChatAiToolCall {
  const record = assertRecord(value, `${errorPrefix} is invalid`);
  return {
    toolCallId: parseRequiredString(record.toolCallId, 'toolCallId', errorPrefix),
    toolName: parseRequiredString(record.toolName, 'toolName', errorPrefix),
    status: parseMessageStatus(record.status, errorPrefix),
    input: parseJsonObject(record.input, 'input', errorPrefix),
    output: typeof record.output === 'undefined' ? undefined : parseJsonValue(record.output, `${errorPrefix}.output`),
    error: typeof record.error === 'undefined' || record.error == null
      ? undefined
      : parseChatAiToolCallError(record.error, `${errorPrefix}.error`),
  };
}

function parseChatAiMessagePart(value: unknown, errorPrefix: string): ChatAiMessagePart {
  const record = assertRecord(value, `${errorPrefix} is invalid`);
  const type = String(record.type || '').trim();
  if (type !== 'text') {
    throw new Error(`${errorPrefix}: unsupported part type`);
  }
  return {
    type: 'text',
    text: String(record.text ?? ''),
  };
}

export function parseChatAiMessageContent(value: unknown): ChatAiMessageContent {
  const record = assertRecord(value, 'chat_ai message content is invalid');
  const parts = Array.isArray(record.parts)
    ? record.parts.map((item, index) => parseChatAiMessagePart(item, `chat_ai content.parts[${index}]`))
    : (() => { throw new Error('chat_ai message content.parts must be an array'); })();
  const toolCalls = Array.isArray(record.toolCalls)
    ? record.toolCalls.map((item, index) => parseChatAiToolCall(item, `chat_ai content.toolCalls[${index}]`))
    : (() => { throw new Error('chat_ai message content.toolCalls must be an array'); })();
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.map((item, index) => parseChatAiAttachment(item, `chat_ai content.attachments[${index}]`))
    : (() => { throw new Error('chat_ai message content.attachments must be an array'); })();
  return {
    parts,
    toolCalls,
    attachments,
    metadata: parseJsonObject(record.metadata, 'metadata', 'chat_ai message content'),
  };
}

export function parseChatAiMessageError(value: unknown): ChatAiMessageError {
  const record = assertRecord(value, 'chat_ai message error is invalid');
  return {
    code: parseOptionalString(record.code),
    message: parseRequiredString(record.message, 'message', 'chat_ai message error'),
  };
}

export function parseChatAiThreadSummary(value: unknown): ChatAiThreadSummary {
  const record = assertRecord(value, 'chat_ai thread summary is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_ai thread summary'),
    title: parseRequiredString(record.title, 'title', 'chat_ai thread summary'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_ai thread summary'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_ai thread summary'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_ai thread summary'),
    routeSnapshot: parseChatAiRouteSnapshot(record.routeSnapshot),
  };
}

export function parseChatAiThreadSummaries(value: unknown): ChatAiThreadSummary[] {
  if (!Array.isArray(value)) {
    throw new Error('chat_ai list_threads returned non-array payload');
  }
  return value.map((item) => parseChatAiThreadSummary(item));
}

export function parseChatAiThreadRecord(value: unknown): ChatAiThreadRecord {
  const record = assertRecord(value, 'chat_ai thread record is invalid');
  return {
    ...parseChatAiThreadSummary(record),
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_ai thread record'),
  };
}

export function parseChatAiMessageRecord(value: unknown): ChatAiMessageRecord {
  const record = assertRecord(value, 'chat_ai message record is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_ai message record'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_ai message record'),
    role: parseMessageRole(record.role, 'chat_ai message record'),
    status: parseMessageStatus(record.status, 'chat_ai message record'),
    contentText: String(record.contentText ?? ''),
    content: parseChatAiMessageContent(record.content),
    error: record.error == null ? null : parseChatAiMessageError(record.error),
    traceId: parseOptionalString(record.traceId) || null,
    parentMessageId: parseOptionalString(record.parentMessageId) || null,
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_ai message record'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_ai message record'),
  };
}

export function parseChatAiDraftRecord(value: unknown): ChatAiDraftRecord {
  const record = assertRecord(value, 'chat_ai draft record is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_ai draft record'),
    text: String(record.text ?? ''),
    attachments: Array.isArray(record.attachments)
      ? record.attachments.map((item, index) => parseChatAiAttachment(item, `chat_ai draft.attachments[${index}]`))
      : (() => { throw new Error('chat_ai draft attachments must be an array'); })(),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_ai draft record'),
  };
}

export function parseChatAiThreadBundle(value: unknown): ChatAiThreadBundle | null {
  if (value == null) {
    return null;
  }
  const record = assertRecord(value, 'chat_ai thread bundle is invalid');
  return {
    thread: parseChatAiThreadRecord(record.thread),
    messages: Array.isArray(record.messages)
      ? record.messages.map((item) => parseChatAiMessageRecord(item))
      : (() => { throw new Error('chat_ai thread bundle.messages must be an array'); })(),
    draft: record.draft == null ? null : parseChatAiDraftRecord(record.draft),
  };
}

function parseNullableStringValue(value: unknown): string | null {
  return parseOptionalString(value) || null;
}

function parseRouteSnapshotInput(value: unknown, errorPrefix: string): ChatAiRouteSnapshot {
  try {
    return parseChatAiRouteSnapshot(value);
  } catch (error) {
    throw new Error(`${errorPrefix}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

export function parseChatAiCreateThreadInput(value: unknown): ChatAiCreateThreadInput {
  const record = assertRecord(value, 'chat_ai create_thread payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_ai create_thread payload'),
    title: parseRequiredString(record.title, 'title', 'chat_ai create_thread payload'),
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_ai create_thread payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_ai create_thread payload'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_ai create_thread payload'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_ai create_thread payload'),
    routeSnapshot: parseRouteSnapshotInput(record.routeSnapshot, 'chat_ai create_thread payload'),
  };
}

export function parseChatAiUpdateThreadMetadataInput(value: unknown): ChatAiUpdateThreadMetadataInput {
  const record = assertRecord(value, 'chat_ai update_thread_metadata payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_ai update_thread_metadata payload'),
    title: parseRequiredString(record.title, 'title', 'chat_ai update_thread_metadata payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_ai update_thread_metadata payload'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_ai update_thread_metadata payload'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_ai update_thread_metadata payload'),
    routeSnapshot: parseRouteSnapshotInput(record.routeSnapshot, 'chat_ai update_thread_metadata payload'),
  };
}

export function parseChatAiCreateMessageInput(value: unknown): ChatAiCreateMessageInput {
  const record = assertRecord(value, 'chat_ai create_message payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_ai create_message payload'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_ai create_message payload'),
    role: parseMessageRole(record.role, 'chat_ai create_message payload'),
    status: parseMessageStatus(record.status, 'chat_ai create_message payload'),
    contentText: String(record.contentText ?? ''),
    content: parseChatAiMessageContent(record.content),
    error: record.error == null ? null : parseChatAiMessageError(record.error),
    traceId: parseNullableStringValue(record.traceId),
    parentMessageId: parseNullableStringValue(record.parentMessageId),
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_ai create_message payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_ai create_message payload'),
  };
}

export function parseChatAiUpdateMessageInput(value: unknown): ChatAiUpdateMessageInput {
  const record = assertRecord(value, 'chat_ai update_message payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_ai update_message payload'),
    status: parseMessageStatus(record.status, 'chat_ai update_message payload'),
    contentText: String(record.contentText ?? ''),
    content: parseChatAiMessageContent(record.content),
    error: record.error == null ? null : parseChatAiMessageError(record.error),
    traceId: parseNullableStringValue(record.traceId),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_ai update_message payload'),
  };
}

export function parseChatAiPutDraftInput(value: unknown): ChatAiPutDraftInput {
  const record = assertRecord(value, 'chat_ai put_draft payload is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_ai put_draft payload'),
    text: String(record.text ?? ''),
    attachments: Array.isArray(record.attachments)
      ? record.attachments.map((item, index) => parseChatAiAttachment(item, `chat_ai put_draft.attachments[${index}]`))
      : (() => { throw new Error('chat_ai put_draft.attachments must be an array'); })(),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_ai put_draft payload'),
  };
}
