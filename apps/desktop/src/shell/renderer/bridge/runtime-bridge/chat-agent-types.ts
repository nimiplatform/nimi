export type AgentLocalMessageRole = 'system' | 'user' | 'assistant';
export type AgentLocalMessageStatus = 'pending' | 'complete' | 'error';

export type AgentLocalTargetSnapshot = {
  agentId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  worldId: string | null;
  worldName: string | null;
  bio: string | null;
  ownershipType: 'MASTER_OWNED' | 'WORLD_OWNED' | null;
};

export type AgentLocalThreadSummary = {
  id: string;
  agentId: string;
  title: string;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
  archivedAtMs: number | null;
  targetSnapshot: AgentLocalTargetSnapshot;
};

export type AgentLocalThreadRecord = AgentLocalThreadSummary & {
  createdAtMs: number;
};

export type AgentLocalMessageError = {
  code?: string;
  message: string;
};

export type AgentLocalMessageRecord = {
  id: string;
  threadId: string;
  role: AgentLocalMessageRole;
  status: AgentLocalMessageStatus;
  contentText: string;
  reasoningText: string | null;
  error: AgentLocalMessageError | null;
  traceId: string | null;
  parentMessageId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgentLocalDraftRecord = {
  threadId: string;
  text: string;
  updatedAtMs: number;
};

export type AgentLocalThreadBundle = {
  thread: AgentLocalThreadRecord;
  messages: AgentLocalMessageRecord[];
  draft: AgentLocalDraftRecord | null;
};

export type AgentLocalCreateThreadInput = {
  id: string;
  agentId: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
  archivedAtMs: number | null;
  targetSnapshot: AgentLocalTargetSnapshot;
};

export type AgentLocalUpdateThreadMetadataInput = {
  id: string;
  title: string;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
  archivedAtMs: number | null;
  targetSnapshot: AgentLocalTargetSnapshot;
};

export type AgentLocalCreateMessageInput = {
  id: string;
  threadId: string;
  role: AgentLocalMessageRole;
  status: AgentLocalMessageStatus;
  contentText: string;
  reasoningText: string | null;
  error: AgentLocalMessageError | null;
  traceId: string | null;
  parentMessageId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgentLocalUpdateMessageInput = {
  id: string;
  status: AgentLocalMessageStatus;
  contentText: string;
  reasoningText: string | null;
  error: AgentLocalMessageError | null;
  traceId: string | null;
  updatedAtMs: number;
};

export type AgentLocalPutDraftInput = {
  threadId: string;
  text: string;
  updatedAtMs: number;
};
