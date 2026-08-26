import type { JsonObject } from './shared.js';
import type {
  NimiRuntimeAgentPresentationProfileProjection,
  NimiRuntimeAgentSourceRef,
} from '@nimiplatform/sdk/runtime';
import type {
  NimiLocalAppConversationAction,
  NimiLocalAppConversationTurn,
  NimiLocalAppConversationVoice,
} from '@nimiplatform/sdk/app';

export type AgentLocalMessageRole = 'system' | 'user' | 'assistant';
export type AgentLocalMessageStatus = 'pending' | 'complete' | 'error';
export type AgentLocalMessageKind = 'text' | 'image' | 'voice';

export type AgentOwnerSettingsProjectionSummary = {
  sourceCoreVersion: number | null;
  selectedOwnerSettingFields: string[];
  communicationStyle: string | null;
};

export type AgentLocalTargetSnapshot = {
  // Canonical Conversation selectors. Formal App chat uses this pair for
  // selection, cache identity, and execution.
  agentHandle?: string;
  conversationAnchorId?: string;
  // Optional Runtime-private presentation sideband. These fields never select
  // or partition a formal App Conversation.
  ownerUserId?: string;
  runtimeSourceRef?: string;
  localAgentRef?: string;
  sourceRef?: NimiRuntimeAgentSourceRef | null;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  defaultVoiceReference?: string | null;
  avatarAutoplay?: boolean | null;
  presentationProfile?: NimiRuntimeAgentPresentationProfileProjection | null;
  worldId: string | null;
  worldName: string | null;
  bio: string | null;
  ownershipType: 'MASTER_OWNED' | 'WORLD_OWNED' | null;
  // Runtime source snapshot content. `greeting` is the source first-turn
  // opening message; when non-empty it seeds the first assistant message of an
  // empty LocalAgent thread. `builtinDocsContext` is optional built-in usage
  // documentation carried on source profile knowledge, attached per-turn as
  // prompt context only (K-AGCORE-140/142).
  // Both are live projection data, not persisted desktop thread state.
  greeting: string | null;
  builtinDocsContext: string | null;
  // Reviewed owner-controlled profile settings projected by Realm. This is a
  // product-safe summary, not a raw source-core mutation payload.
  ownerSettingsProjection?: AgentOwnerSettingsProjectionSummary | null;
};

export type AgentLocalThreadSummary = {
  id: string;
  ownerUserId?: string;
  runtimeSourceRef?: string;
  localAgentRef?: string;
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

export type AgentLocalThreadBundle = {
  thread: AgentLocalThreadRecord;
  messages: AgentLocalMessageRecord[];
  canonicalConversation?: {
    conversationAnchorId: string;
    throughSequence: string;
    truncatedBefore: boolean;
    turns: readonly NimiLocalAppConversationTurn[];
    actions: readonly NimiLocalAppConversationAction[];
    voices: readonly NimiLocalAppConversationVoice[];
  };
};
