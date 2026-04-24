import type { JsonObject } from './shared.js';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';

export type AgentLocalMessageRole = 'system' | 'user' | 'assistant';
export type AgentLocalMessageStatus = 'pending' | 'complete' | 'error';
export type AgentLocalMessageKind = 'text' | 'image' | 'voice';
export type AgentLocalTurnRole = 'system' | 'user' | 'assistant';
export type AgentLocalTurnStatus = 'pending' | 'completed' | 'failed' | 'canceled';
export type AgentLocalBeatModality = 'text' | 'voice' | 'image' | 'video';
export type AgentLocalBeatStatus = 'planned' | 'sealed' | 'delivered' | 'failed' | 'canceled';

export type AgentLocalTargetSnapshot = {
  agentId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  presentationProfile?: AvatarPresentationProfile | null;
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
  kind: AgentLocalMessageKind;
  contentText: string;
  reasoningText: string | null;
  error: AgentLocalMessageError | null;
  traceId: string | null;
  parentMessageId: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  artifactId: string | null;
  metadataJson: JsonObject | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgentLocalDraftRecord = {
  threadId: string;
  text: string;
  updatedAtMs: number;
};

export type AgentLocalTurnRecord = {
  id: string;
  threadId: string;
  role: AgentLocalTurnRole;
  status: AgentLocalTurnStatus;
  providerMode: string;
  traceId: string | null;
  promptTraceId: string | null;
  startedAtMs: number;
  completedAtMs: number | null;
  abortedAtMs: number | null;
};

export type AgentLocalTurnBeatRecord = {
  id: string;
  turnId: string;
  beatIndex: number;
  modality: AgentLocalBeatModality;
  status: AgentLocalBeatStatus;
  textShadow: string | null;
  artifactId: string | null;
  mimeType: string | null;
  mediaUrl: string | null;
  projectionMessageId: string | null;
  createdAtMs: number;
  deliveredAtMs: number | null;
};

export type AgentLocalInteractionSnapshotRecord = {
  threadId: string;
  version: number;
  relationshipState: string;
  emotionalTemperature: number;
  assistantCommitmentsJson: Record<string, unknown> | unknown[];
  userPrefsJson: Record<string, unknown> | unknown[];
  openLoopsJson: Record<string, unknown> | unknown[];
  updatedAtMs: number;
};

export type AgentLocalRelationMemorySlotRecord = {
  id: string;
  threadId: string;
  slotType: string;
  summary: string;
  sourceTurnId: string | null;
  sourceBeatId?: string | null;
  sourceMessageId?: string | null;
  score: number;
  updatedAtMs: number;
};

export type AgentLocalRecallEntryRecord = {
  id: string;
  threadId: string;
  sourceTurnId: string | null;
  sourceBeatId?: string | null;
  sourceMessageId?: string | null;
  summary: string;
  searchText: string;
  updatedAtMs: number;
};

export type AgentLocalThreadBundle = {
  thread: AgentLocalThreadRecord;
  messages: AgentLocalMessageRecord[];
  draft: AgentLocalDraftRecord | null;
};

export type AgentLocalTurnContext = {
  thread: AgentLocalThreadRecord;
  recentTurns: AgentLocalTurnRecord[];
  recentBeats: AgentLocalTurnBeatRecord[];
  interactionSnapshot: AgentLocalInteractionSnapshotRecord | null;
  relationMemorySlots: AgentLocalRelationMemorySlotRecord[];
  recallEntries: AgentLocalRecallEntryRecord[];
  draft: AgentLocalDraftRecord | null;
  projectionVersion: string;
};

export type AgentLocalProjectionRebuildResult = {
  bundle: AgentLocalThreadBundle;
  projectionVersion: string;
};

export type AgentLocalCommitTurnResult = {
  turn: AgentLocalTurnRecord;
  beats: AgentLocalTurnBeatRecord[];
  interactionSnapshot: AgentLocalInteractionSnapshotRecord | null;
  relationMemorySlots: AgentLocalRelationMemorySlotRecord[];
  recallEntries: AgentLocalRecallEntryRecord[];
  bundle: AgentLocalThreadBundle;
  projectionVersion: string;
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
  kind: AgentLocalMessageKind;
  contentText: string;
  reasoningText: string | null;
  error: AgentLocalMessageError | null;
  traceId: string | null;
  parentMessageId: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  artifactId: string | null;
  metadataJson: JsonObject | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgentLocalUpdateMessageInput = {
  id: string;
  kind: AgentLocalMessageKind;
  status: AgentLocalMessageStatus;
  contentText: string;
  reasoningText: string | null;
  error: AgentLocalMessageError | null;
  traceId: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  artifactId: string | null;
  metadataJson: JsonObject | null;
  updatedAtMs: number;
};

export type AgentLocalPutDraftInput = {
  threadId: string;
  text: string;
  updatedAtMs: number;
};

export type AgentLocalLoadTurnContextInput = {
  threadId: string;
  recentTurnLimit?: number;
  relationMemoryLimit?: number;
  recallLimit?: number;
};

export type AgentLocalTurnRecordInput = Omit<AgentLocalTurnRecord, never>;

export type AgentLocalTurnBeatInput = Omit<AgentLocalTurnBeatRecord, never>;

export type AgentLocalUpdateTurnBeatInput = {
  id: string;
  status: AgentLocalBeatStatus;
  textShadow: string | null;
  artifactId: string | null;
  mimeType: string | null;
  mediaUrl: string | null;
  deliveredAtMs: number | null;
};

export type AgentLocalInteractionSnapshotInput = Omit<AgentLocalInteractionSnapshotRecord, never>;

export type AgentLocalRelationMemorySlotInput = Omit<AgentLocalRelationMemorySlotRecord, never>;

export type AgentLocalRecallEntryInput = Omit<AgentLocalRecallEntryRecord, never>;

export type AgentLocalProjectionMessageInput = AgentLocalMessageRecord;

export type AgentLocalProjectionCommitInput = {
  thread: AgentLocalUpdateThreadMetadataInput;
  messages: AgentLocalProjectionMessageInput[];
  draft: AgentLocalPutDraftInput | null;
  clearDraft: boolean;
};

export type AgentLocalCommitTurnResultInput = {
  threadId: string;
  turn: AgentLocalTurnRecordInput;
  beats: AgentLocalTurnBeatInput[];
  interactionSnapshot: AgentLocalInteractionSnapshotInput | null;
  relationMemorySlots: AgentLocalRelationMemorySlotInput[];
  recallEntries: AgentLocalRecallEntryInput[];
  projection: AgentLocalProjectionCommitInput;
};

export type AgentLocalCancelTurnInput = {
  threadId: string;
  turnId: string;
  scope: 'turn' | 'projection';
  abortedAtMs: number;
};
