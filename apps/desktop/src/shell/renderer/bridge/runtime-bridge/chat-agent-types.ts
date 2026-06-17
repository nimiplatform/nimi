import type { JsonObject } from './shared.js';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';

export type AgentLocalMessageRole = 'system' | 'user' | 'assistant';
export type AgentLocalMessageStatus = 'pending' | 'complete' | 'error';
export type AgentLocalMessageKind = 'text' | 'image' | 'voice';

export type AgentOwnerSettingsProjectionSummary = {
  agentRuleVersion: number | null;
  selectedOwnerSettingFields: string[];
  communicationStyle: string | null;
};

export type AgentSpeechSynthesisRoute = {
  modelId: string;
  routePolicy: 'local' | 'cloud';
};

export type AgentLocalTargetSnapshot = {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  defaultVoiceReference?: string | null;
  speechSynthesis?: AgentSpeechSynthesisRoute | null;
  avatarAutoplay?: boolean | null;
  presentationProfile?: AvatarPresentationProfile | null;
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
  // product-safe summary, not the raw rules cache or AgentRule statements.
  ownerSettingsProjection?: AgentOwnerSettingsProjectionSummary | null;
};

export type AgentLocalThreadSummary = {
  id: string;
  ownerUserId: string;
  runtimeSourceRef: string;
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

export type AgentLocalThreadBundle = {
  thread: AgentLocalThreadRecord;
  messages: AgentLocalMessageRecord[];
};
