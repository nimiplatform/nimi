import type { JsonObject } from './shared.js';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';

export type AgentLocalMessageRole = 'system' | 'user' | 'assistant';
export type AgentLocalMessageStatus = 'pending' | 'complete' | 'error';
export type AgentLocalMessageKind = 'text' | 'image' | 'voice';
export type AgentLocalTurnRole = 'system' | 'user' | 'assistant';
export type AgentLocalTurnStatus = 'pending' | 'completed' | 'failed' | 'canceled';
export type AgentLocalBeatModality = 'text' | 'voice' | 'image' | 'video';
export type AgentLocalBeatStatus = 'planned' | 'sealed' | 'delivered' | 'failed' | 'canceled';

export type AgentLocalTargetSnapshot = {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  presentationProfile?: AvatarPresentationProfile | null;
  worldId: string | null;
  worldName: string | null;
  bio: string | null;
  ownershipType: 'MASTER_OWNED' | 'WORLD_OWNED' | null;
  // Ordinary RealmAgent profile content projected from the Realm/SDK agent
  // projection. `greeting` is the RealmAgent's first-turn opening message
  // (`AgentProfile.greeting`); when non-empty it seeds the first assistant
  // message of an empty AgentFriend thread. `builtinDocsContext` is optional
  // built-in usage documentation carried on the RealmAgent profile knowledge
  // payload, attached per-turn as prompt context only (K-AGCORE-140/142).
  // Both are live projection data, not persisted desktop thread state.
  greeting: string | null;
  builtinDocsContext: string | null;
};

export type AgentLocalThreadSummary = {
  id: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  title: string;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
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

export type AgentLocalThreadBundle = {
  thread: AgentLocalThreadRecord;
  messages: AgentLocalMessageRecord[];
};

export type AgentLocalCommitTurnResult = {
  turn: AgentLocalTurnRecord;
  beats: AgentLocalTurnBeatRecord[];
  bundle: AgentLocalThreadBundle;
};

export type AgentLocalCreateThreadInput = {
  id: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
  targetSnapshot: AgentLocalTargetSnapshot;
};

export type AgentLocalUpdateThreadMetadataInput = {
  id: string;
  title: string;
  updatedAtMs: number;
  lastMessageAtMs: number | null;
  targetSnapshot: AgentLocalTargetSnapshot;
};

export type AgentLocalTurnRecordInput = Omit<AgentLocalTurnRecord, never>;

export type AgentLocalTurnBeatInput = Omit<AgentLocalTurnBeatRecord, never>;

export type AgentLocalProjectionMessageInput = AgentLocalMessageRecord;

export type AgentLocalProjectionCommitInput = {
  thread: AgentLocalUpdateThreadMetadataInput;
  messages: AgentLocalProjectionMessageInput[];
};

export type AgentLocalCommitTurnResultInput = {
  threadId: string;
  turn: AgentLocalTurnRecordInput;
  beats: AgentLocalTurnBeatInput[];
  projection: AgentLocalProjectionCommitInput;
};
