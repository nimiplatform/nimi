import type { JsonObject, JsonValue } from './shared.js';

export type ChatAiRouteKind = 'local' | 'cloud';
export type ChatAiMessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type ChatAiMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'canceled';

export type ChatAiRouteSnapshot = {
  routeKind: ChatAiRouteKind;
  connectorId: string | null;
  provider: string | null;
  modelId: string | null;
  routeBinding: JsonObject | null;
};

export type ChatAiThreadSummary = {
  id: string;
  title: string;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
  archivedAtMs: number | null;
  routeSnapshot: ChatAiRouteSnapshot;
};

export type ChatAiThreadRecord = ChatAiThreadSummary & {
  createdAtMs: number;
};

export type ChatAiMessagePart = {
  type: 'text';
  text: string;
};

export type ChatAiToolCallError = {
  code?: string;
  message: string;
};

export type ChatAiToolCall = {
  toolCallId: string;
  toolName: string;
  status: ChatAiMessageStatus;
  input: JsonObject;
  output?: JsonValue;
  error?: ChatAiToolCallError;
};

export type ChatAiAttachment = {
  attachmentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type ChatAiMessageContent = {
  parts: ChatAiMessagePart[];
  toolCalls: ChatAiToolCall[];
  attachments: ChatAiAttachment[];
  metadata: JsonObject;
};

export type ChatAiMessageError = {
  code?: string;
  message: string;
};

export type ChatAiMessageRecord = {
  id: string;
  threadId: string;
  role: ChatAiMessageRole;
  status: ChatAiMessageStatus;
  contentText: string;
  content: ChatAiMessageContent;
  error: ChatAiMessageError | null;
  traceId: string | null;
  parentMessageId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type ChatAiDraftRecord = {
  threadId: string;
  text: string;
  attachments: ChatAiAttachment[];
  updatedAtMs: number;
};

export type ChatAiThreadBundle = {
  thread: ChatAiThreadRecord;
  messages: ChatAiMessageRecord[];
  draft: ChatAiDraftRecord | null;
};

export type ChatAiCreateThreadInput = {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
  archivedAtMs: number | null;
  routeSnapshot: ChatAiRouteSnapshot;
};

export type ChatAiUpdateThreadMetadataInput = {
  id: string;
  title: string;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
  archivedAtMs: number | null;
  routeSnapshot: ChatAiRouteSnapshot;
};

export type ChatAiCreateMessageInput = {
  id: string;
  threadId: string;
  role: ChatAiMessageRole;
  status: ChatAiMessageStatus;
  contentText: string;
  content: ChatAiMessageContent;
  error: ChatAiMessageError | null;
  traceId: string | null;
  parentMessageId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type ChatAiUpdateMessageInput = {
  id: string;
  status: ChatAiMessageStatus;
  contentText: string;
  content: ChatAiMessageContent;
  error: ChatAiMessageError | null;
  traceId: string | null;
  updatedAtMs: number;
};

export type ChatAiPutDraftInput = {
  threadId: string;
  text: string;
  attachments: ChatAiAttachment[];
  updatedAtMs: number;
};
