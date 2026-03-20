// Relay chat pipeline types — consolidated from local-chat types.ts + state/ledger-types.ts
// Adapted: removed mod SDK dependencies, React types; self-contained for Electron main process.

import type { PromptLayerId } from '../prompt/types.js';
import type { JsonObject } from '../../shared/json.js';

// ── Enums / Unions ──────────────────────────────────────────────────

export type LocalChatMediaKind = 'image' | 'video';
export type LocalChatMediaIntentSource = 'tag' | 'explicit' | 'planner';
export type LocalChatMediaPlannerTrigger =
  | 'user-explicit'
  | 'assistant-offer'
  | 'scene-enhancement'
  | 'none'
  | 'marker-override';
export type LocalChatMediaRouteSource = 'local' | 'cloud';
export type LocalChatResolvedMediaRouteSource = LocalChatMediaRouteSource;
export type LocalChatResolvedMediaRouteResolvedBy = 'resolved-default' | 'selected' | 'preflight';
export type LocalChatMediaCacheStatus = 'none' | 'hit' | 'miss';
export type LocalChatMediaArtifactStatus = 'ready' | 'blocked' | 'failed';
export type LocalChatBeatModality = 'text' | 'voice' | 'image' | 'video';
export type LocalChatTurnMode =
  | 'information'
  | 'emotional'
  | 'playful'
  | 'intimate'
  | 'checkin'
  | 'explicit-media'
  | 'explicit-voice';

// ── Media types ─────────────────────────────────────────────────────

export type LocalChatMediaHints = {
  composition?: string;
  negativeCues?: string[];
  continuityRefs?: string[];
};

export type LocalChatMediaGenerationSpec = {
  kind: LocalChatMediaKind;
  intentSource: LocalChatMediaIntentSource;
  plannerTrigger: LocalChatMediaPlannerTrigger;
  confidence: number | null;
  nsfwIntent: 'none' | 'suggested';
  targetId: string;
  worldId: string | null;
  subject: string;
  scene: string;
  styleIntent: string;
  mood: string;
  requestedSize?: string;
  requestedCount?: number;
  requestedDurationSeconds?: number;
  hints?: LocalChatMediaHints;
};

export type LocalChatCompiledMediaExecution = {
  compiledPromptText: string;
  runtimePayload: {
    prompt: string;
    model?: string;
    negativePrompt?: string;
    size?: string;
    aspectRatio?: string;
    quality?: string;
    style?: string;
    n?: number;
    durationSeconds?: number;
    cameraMotion?: string;
  };
  compilerRevision: string;
};

export type LocalChatResolvedMediaRoute = {
  source: LocalChatResolvedMediaRouteSource;
  connectorId?: string;
  model: string;
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: string;
  provider?: string;
  resolvedBy: LocalChatResolvedMediaRouteResolvedBy;
  resolvedAt: string;
  settingsRevision: string;
  routeOptionsRevision: number;
};

export type LocalChatMediaArtifactShadow = {
  kind: LocalChatMediaKind;
  status: LocalChatMediaArtifactStatus;
  subject: string;
  scene: string;
  styleIntent: string;
  mood: string;
  routeSource: LocalChatMediaRouteSource;
  routeModel: string | null;
  assetOrigin: 'generated' | 'cache-hit';
  shadowText: string;
};

export type LocalChatCachedMediaAsset = {
  executionCacheKey: string;
  specHash: string;
  kind: LocalChatMediaKind;
  renderUri: string;
  mimeType: string;
  routeSource: LocalChatMediaRouteSource;
  connectorId?: string;
  model?: string;
  createdAt: string;
  lastHitAt: string;
};

// ── Message types ───────────────────────────────────────────────────

export type ChatMessageKind =
  | 'text'
  | 'voice'
  | 'image'
  | 'video'
  | 'image-pending'
  | 'video-pending'
  | 'streaming';

export type ChatMessageMedia = {
  uri?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  previewUri?: string;
};

export type ChatMessageMeta = {
  interactionPlanId?: string;
  turnId?: string;
  beatId?: string;
  beatIndex?: number;
  beatCount?: number;
  beatModality?: LocalChatBeatModality;
  pauseMs?: number;
  relationMove?: string;
  sceneMove?: string;
  turnMode?: LocalChatTurnMode;
  voiceConversationMode?: 'off' | 'on';
  autoPlayVoice?: boolean;
  planId?: string;
  segmentId?: string;
  segmentIndex?: number;
  segmentCount?: number;
  intent?: string;
  scheduledDelayMs?: number;
  channelDecision?: 'text' | 'voice';
  routeSource?: 'local' | 'cloud';
  routeModel?: string;
  audioUri?: string;
  audioBytes?: Uint8Array;
  audioMimeType?: string;
  streamId?: string;
  streamChunkCount?: number;
  nsfwPolicy?: 'disabled' | 'local-only' | 'allowed';
  segmentParseMode?: 'explicit-delimiter' | 'double-newline' | 'single-message';
  mediaType?: 'image' | 'video';
  mediaStatus?: 'pending' | 'ready' | 'failed' | 'blocked';
  mediaPrompt?: string;
  mediaIntentSource?: 'tag' | 'explicit' | 'planner';
  mediaError?: string;
  mediaPlannerTrigger?: 'user-explicit' | 'assistant-offer' | 'scene-enhancement' | 'none' | 'marker-override';
  mediaPlannerConfidence?: number;
  mediaPlannerBlockedReason?: string;
  mediaSpec?: LocalChatMediaGenerationSpec;
  mediaSpecHash?: string;
  mediaShadow?: LocalChatMediaArtifactShadow;
  mediaCacheStatus?: LocalChatMediaCacheStatus;
  mediaExecutionCacheKey?: string;
  mediaResolvedRoute?: LocalChatResolvedMediaRoute;
  mediaCompilerRevision?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  kind: ChatMessageKind;
  content: string;
  media?: ChatMessageMedia;
  timestamp: Date;
  latencyMs?: number;
  meta?: ChatMessageMeta;
};

export type HealthStatus = 'idle' | 'checking' | 'healthy' | 'unreachable';

// ── Context lane / profile types ────────────────────────────────────

export type LocalChatContextLaneId =
  | 'identity'
  | 'world'
  | 'platformWarmStart'
  | 'sessionRecall'
  | 'recentTurns'
  | 'userInput'
  | 'interactionProfile'
  | 'interactionState'
  | 'relationMemory'
  | 'turnMode';

export type VoiceConversationMode = 'off' | 'on';

export type DerivedInteractionProfile = {
  expression: {
    responseLength: 'short' | 'medium' | 'long';
    formality: 'casual' | 'formal' | 'slang';
    sentiment: 'positive' | 'neutral' | 'cynical';
    pacingBias: 'reserved' | 'balanced' | 'bursty';
    firstBeatStyle: 'gentle' | 'playful' | 'direct' | 'intimate' | 'grounded';
    infoAnswerStyle: 'concise' | 'balanced' | 'guided';
    emojiUsage: 'none' | 'occasional' | 'frequent';
  };
  relationship: {
    defaultDistance: 'formal' | 'friendly' | 'warm' | 'intimate';
    warmth: 'cool' | 'warm' | 'intimate';
    flirtAffinity: 'none' | 'light' | 'high';
    proactiveStyle: 'quiet' | 'gentle' | 'playful';
    intimacyGuard: 'strict' | 'balanced' | 'open';
  };
  voice: {
    voiceId: string | null;
    language: string | null;
    genderGuard: 'male' | 'female' | 'neutral' | 'unspecified';
    speedRange: 'slow' | 'balanced' | 'fast';
    pitchRange: 'low' | 'mid' | 'bright';
    emotionEnabled: boolean;
    voiceAffinity: 'low' | 'medium' | 'high';
  };
  visual: {
    artStyle: string | null;
    fashionStyle: string | null;
    personaCue: string | null;
    nsfwLevel: string | null;
    imageAffinity: 'low' | 'medium' | 'high';
    videoAffinity: 'low' | 'medium' | 'high';
  };
  modalityTraits: {
    textBias: 'low' | 'medium' | 'high';
    voiceBias: 'low' | 'medium' | 'high';
    imageBias: 'low' | 'medium' | 'high';
    videoBias: 'low' | 'medium' | 'high';
    latencyTolerance: 'low' | 'medium' | 'high';
  };
  signals: string[];
};

export type LocalChatReplyStyleProfile = {
  responseLength: 'short' | 'medium' | 'long';
  formality: 'casual' | 'formal' | 'slang';
  sentiment: 'positive' | 'neutral' | 'cynical';
  relationshipMode: string;
  pacingStyle: 'reserved' | 'balanced' | 'bursty';
  followupStyle: 'rare' | 'situational' | 'eager';
  warmth: 'cool' | 'warm' | 'intimate';
  signals: string[];
};

export type LocalChatReplyPacingPlan = {
  mode: 'single' | 'burst-2' | 'answer-followup' | 'burst-3';
  maxSegments: 1 | 2 | 3;
  energy: 'low' | 'medium' | 'high';
  reason: string;
};

// ── Beat / turn planning types ──────────────────────────────────────

export type InteractionBeatAssetRequest = {
  kind: 'image' | 'video';
  prompt: string;
  confidence: number;
  nsfwIntent: 'none' | 'suggested';
};

export type InteractionBeat = {
  beatId: string;
  turnId: string;
  beatIndex: number;
  beatCount: number;
  intent: 'answer' | 'clarify' | 'checkin' | 'comfort' | 'tease' | 'invite' | 'media';
  relationMove: string;
  sceneMove: string;
  modality: LocalChatBeatModality;
  text: string;
  pauseMs: number;
  assetRequest?: InteractionBeatAssetRequest;
  cancellationScope: 'turn' | 'tail';
  autoPlayVoice?: boolean;
};

export type InteractionTurnPlan = {
  planId: string;
  turnId: string;
  turnMode: LocalChatTurnMode;
  beats: InteractionBeat[];
  expiresAt: string;
};

export type FirstBeatResult = {
  text: string;
  transientMessageId: string;
  traceId: string | null;
  latencyMs: number;
  streamDeltaCount: number;
  streamDurationMs: number;
};

export type LocalChatTurnSendPhase =
  | 'idle'
  | 'awaiting-first-beat'
  | 'streaming-first-beat'
  | 'planning-tail'
  | 'delivering-tail';

// ── Interaction state types ─────────────────────────────────────────

export type InteractionSnapshot = {
  conversationId: string;
  relationshipState: 'new' | 'friendly' | 'warm' | 'intimate';
  activeScene: string[];
  emotionalTemperature: 'low' | 'steady' | 'warm' | 'heated';
  assistantCommitments: string[];
  userPrefs: string[];
  openLoops: string[];
  topicThreads: string[];
  lastResolvedTurnId: string | null;
  conversationDirective: string | null;
  conversationMomentum?: 'accelerating' | 'steady' | 'cooling';
  updatedAt: string;
};

export type RelationMemorySlotType =
  | 'preference'
  | 'boundary'
  | 'rapport'
  | 'promise'
  | 'recurringCue'
  | 'taboo';

export type RelationMemorySlot = {
  id: string;
  targetId: string;
  viewerId: string;
  slotType: RelationMemorySlotType;
  key: string;
  value: string;
  confidence: number;
  portability: 'portable' | 'local-only' | 'blocked';
  sensitivity: 'safe' | 'personal' | 'intimate';
  userOverride: 'inherit' | 'never-sync' | 'force-portable';
  updatedAt: string;
};

export type InteractionRecallDoc = {
  id: string;
  conversationId: string;
  sourceTurnId: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
};

// ── Prompt trace / audit types ──────────────────────────────────────

export type LocalChatPromptLaneBudget = {
  maxChars: number;
  usedChars: number;
  truncated: boolean;
};

export type LocalChatContextTrace = {
  id: string;
  conversationId: string;
  routeSource: string;
  routeModel: string;
  promptChars: number;
  layerOrder: PromptLayerId[];
  appliedLayers: PromptLayerId[];
  droppedLayers: PromptLayerId[];
  laneChars: Partial<Record<LocalChatContextLaneId, number>>;
  truncationByLane: Partial<Record<LocalChatContextLaneId, boolean>>;
  memorySlices?: {
    core: number;
    e2e: number;
    worldLore: number;
    agentLore: number;
  };
  budget: {
    maxChars: number;
    usedChars: number;
    truncated: boolean;
  };
  laneBudgets: Partial<Record<LocalChatContextLaneId, LocalChatPromptLaneBudget>>;
  compilerVersion: 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7';
  planner?: 'stream';
  turnMode?: LocalChatTurnMode;
  interactionProfile?: DerivedInteractionProfile;
  voiceConversationMode?: VoiceConversationMode;
  planSegments?: number;
  voiceSegments?: number;
  textSegments?: number;
  schedulerTotalDelayMs?: number;
  streamDeltaCount?: number;
  streamDurationMs?: number;
  segmentParseMode?: 'explicit-delimiter' | 'double-newline' | 'single-message';
  pacingPlan?: LocalChatReplyPacingPlan;
  nsfwPolicy?: 'disabled' | 'local-only' | 'allowed';
  plannerUsed?: boolean;
  plannerKind?: 'none' | 'image' | 'video';
  plannerTrigger?: 'user-explicit' | 'assistant-offer' | 'scene-enhancement' | 'none' | 'marker-override';
  plannerConfidence?: number | null;
  plannerBlockedReason?: string | null;
  imageReady?: boolean;
  videoReady?: boolean;
  imageDependencyStatus?: 'ready' | 'missing' | 'degraded' | 'unknown' | null;
  videoDependencyStatus?: 'ready' | 'missing' | 'degraded' | 'unknown' | null;
  mediaDecisionSource?: 'tag' | 'explicit' | 'planner' | 'none';
  mediaDecisionKind?: 'none' | 'image' | 'video';
  mediaExecutionStatus?: 'none' | 'blocked' | 'pending' | 'ready' | 'failed';
  mediaExecutionRouteSource?: 'local' | 'cloud' | null;
  mediaExecutionRouteModel?: string | null;
  mediaExecutionReason?: string | null;
  selectedTurnSeqs: number[];
  sessionRecallCount: number;
  createdAt: string;
};

export type LocalChatPromptTrace = LocalChatContextTrace;

export type LocalChatTurnAudit = {
  id: string;
  targetId: string;
  worldId: string | null;
  latencyMs: number;
  error: string | null;
  createdAt: string;
};

// ── Storage record types ────────────────────────────────────────────

export type LocalChatStoredBeat = {
  id: string;
  turnId: string;
  turnSeq: number;
  conversationId: string;
  role: 'user' | 'assistant';
  beatIndex: number;
  beatCount: number;
  kind: Exclude<ChatMessageKind, 'streaming' | 'image-pending' | 'video-pending'>;
  deliveryStatus: 'pending' | 'ready' | 'blocked' | 'failed';
  content: string;
  contextText: string;
  semanticSummary: string | null;
  mediaSpec?: LocalChatMediaGenerationSpec;
  mediaShadow?: LocalChatMediaArtifactShadow;
  media?: ChatMessageMedia;
  timestamp: string;
  latencyMs?: number;
  meta?: ChatMessageMeta;
  promptTrace?: LocalChatContextTrace;
  audit?: LocalChatTurnAudit;
};

export type LocalChatTurnRecord = {
  id: string;
  conversationId: string;
  seq: number;
  role: 'user' | 'assistant';
  turnTxnId: string | null;
  createdAt: string;
  updatedAt: string;
  beatCount: number;
};

export type LocalChatTurnWithBeats = LocalChatTurnRecord & {
  beats: LocalChatStoredBeat[];
};

export type LocalChatConversationRecord = {
  id: string;
  targetId: string;
  viewerId: string;
  worldId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastTurnSeq: number;
};

export type LocalChatMediaAssetRecord = LocalChatCachedMediaAsset & {
  id: string;
  conversationId: string | null;
  turnId: string | null;
  beatId: string | null;
};

export type LocalChatPlatformWarmStartMemory = {
  core: string[];
  e2e: string[];
  recallSource: 'local-index-only' | 'local-index+remote-backfill' | 'remote-only';
  entityId: string | null;
};

export type LocalChatTurn = {
  id: string;
  turnId: string;
  turnSeq: number;
  beatIndex: number;
  beatCount: number;
  role: 'user' | 'assistant';
  kind: Exclude<ChatMessageKind, 'streaming' | 'image-pending' | 'video-pending'>;
  content: string;
  contextText: string;
  semanticSummary?: string | null;
  mediaSpec?: LocalChatMediaGenerationSpec;
  mediaShadow?: LocalChatMediaArtifactShadow;
  media?: ChatMessageMedia;
  timestamp: string;
  latencyMs?: number;
  meta?: ChatMessageMeta;
  promptTrace?: LocalChatContextTrace;
  audit?: LocalChatTurnAudit;
};

export type LocalChatSession = {
  id: string;
  targetId: string;
  viewerId: string;
  worldId: string | null;
  title: string;
  turns: LocalChatTurn[];
  turnCount: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

// ── Context packet types ────────────────────────────────────────────

export type LocalChatContextRecentTurn = {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  lines: string[];
};

export type LocalChatContextPacket = {
  conversationId: string;
  viewer: {
    id: string;
    displayName: string;
  };
  target: {
    id: string;
    handle: string;
    displayName: string;
    bio: string | null;
    identityLines: string[];
    rulesLines: string[];
    replyStyleLines: string[];
    interactionProfileLines?: string[];
    interactionProfile: DerivedInteractionProfile;
  };
  world: {
    worldId: string | null;
    lines: string[];
  };
  platformWarmStart: LocalChatPlatformWarmStartMemory | null;
  sessionRecall: Array<{
    id: string;
    text: string;
    sourceKind: 'turn' | 'recall-index';
    sourceTurnId: string | null;
  }>;
  recentTurns: LocalChatContextRecentTurn[];
  interactionSnapshot?: InteractionSnapshot | null;
  relationMemorySlots?: RelationMemorySlot[];
  recallIndex?: InteractionRecallDoc[];
  turnMode?: LocalChatTurnMode;
  voiceConversationMode?: VoiceConversationMode;
  contentBoundaryHint?: {
    visualComfortLevel: 'text-only' | 'restrained-visuals' | 'natural-visuals';
    relationshipBoundaryPreset: 'reserved' | 'balanced' | 'close';
  };
  pacingPlan: LocalChatReplyPacingPlan;
  perceptionOverlay?: {
    refinedTurnMode: LocalChatTurnMode;
    emotionalState: string;
    emotionalCause: string;
    suggestedApproach: string;
    directive: string;
    intimacyCeiling: string;
  };
  promptLocale: 'en' | 'zh';
  userInput: string;
  diagnostics: {
    selectedTurnSeqs: number[];
    sessionRecallCount: number;
  };
};

// ── Turn send types (adapted for main process — no React deps) ──────

export type ChatRouteSnapshot = {
  source: string;
  model: string;
  connectorId?: string;
  provider?: string;
  localModelId?: string;
};

export type AssistantPlanChannel = 'auto' | 'text' | 'voice';
export type AssistantPlanIntent = 'answer' | 'clarify' | 'plan' | 'checkin' | 'followup';
export type SegmentParseMode = 'explicit-delimiter' | 'double-newline' | 'single-message';
export type LocalChatScheduleCancelReason =
  | 'LOCAL_CHAT_SCHEDULE_CANCELLED_BY_NEW_USER_TURN'
  | 'LOCAL_CHAT_SCHEDULE_CANCELLED_BY_CONTEXT_CHANGE'
  | 'LOCAL_CHAT_SCHEDULE_CANCELLED_BY_UNMOUNT'
  | 'LOCAL_CHAT_SCHEDULE_CANCELLED_BY_USER';

export type AssistantPlanSegment = {
  id: string;
  content: string;
  delayMs: number;
  channel: AssistantPlanChannel;
  intent: AssistantPlanIntent;
  reason?: string;
};

export type InteractionDeliveryBeat = InteractionBeat & {
  kind: 'text' | 'voice' | 'image' | 'video';
  media?: ChatMessage['media'];
  meta?: ChatMessage['meta'];
};

// ── Media decision types ────────────────────────────────────────────

export type MediaIntentSource = LocalChatMediaGenerationSpec['intentSource'];
export type MediaDecisionSource = MediaIntentSource | 'none';
export type MediaDependencyStatus = 'ready' | 'missing' | 'degraded' | 'unknown';
export type MediaExecutionStatus = 'none' | 'blocked' | 'pending' | 'ready' | 'failed';
export type MediaRouteSource = LocalChatMediaRouteSource;

export type MediaPlannerTrigger = LocalChatMediaPlannerTrigger;

export type PendingMediaIntent = {
  type: 'image' | 'video';
  prompt: string;
  source: MediaIntentSource;
  plannerTrigger: MediaPlannerTrigger;
  plannerConfidence?: number;
  plannerSuggestsNsfw?: boolean;
  pendingMessageId: string;
};

export type PreparedMediaExecution = {
  spec: LocalChatMediaGenerationSpec;
  specHash: string;
  compiled: LocalChatCompiledMediaExecution;
  pendingMessageId: string;
};

export type MediaPromptTracePatch = {
  plannerUsed: boolean;
  plannerKind: 'none' | 'image' | 'video';
  plannerTrigger: MediaPlannerTrigger;
  plannerConfidence: number | null;
  plannerBlockedReason: string | null;
  mediaDecisionSource: MediaDecisionSource;
  mediaDecisionKind: 'none' | 'image' | 'video';
  mediaExecutionStatus: MediaExecutionStatus;
  mediaExecutionRouteSource: MediaRouteSource | null;
  mediaExecutionRouteModel: string | null;
  mediaExecutionReason: string | null;
  mediaSpecHash: string | null;
  mediaCompilerRevision: string | null;
  mediaRouteResolvedBy: LocalChatResolvedMediaRoute['resolvedBy'] | null;
  mediaCacheStatus: 'none' | 'hit' | 'miss' | null;
  mediaShadowText: string | null;
};

export type MediaExecutionDecision =
  | {
      kind: 'none';
      promptTracePatch: MediaPromptTracePatch;
    }
  | {
      kind: 'blocked';
      intent: PendingMediaIntent;
      prepared: PreparedMediaExecution;
      blockedReason: string;
      routeSource: MediaRouteSource;
      resolvedRoute: LocalChatResolvedMediaRoute | null;
      promptTracePatch: MediaPromptTracePatch;
    }
  | {
      kind: 'execute';
      intent: PendingMediaIntent;
      prepared: PreparedMediaExecution;
      resolvedRoute: LocalChatResolvedMediaRoute;
      promptTracePatch: MediaPromptTracePatch;
    };

export function createDefaultMediaPromptTracePatch(): MediaPromptTracePatch {
  return {
    plannerUsed: false,
    plannerKind: 'none',
    plannerTrigger: 'none',
    plannerConfidence: null,
    plannerBlockedReason: null,
    mediaDecisionSource: 'none',
    mediaDecisionKind: 'none',
    mediaExecutionStatus: 'none',
    mediaExecutionRouteSource: null,
    mediaExecutionRouteModel: null,
    mediaExecutionReason: null,
    mediaSpecHash: null,
    mediaCompilerRevision: null,
    mediaRouteResolvedBy: null,
    mediaCacheStatus: null,
    mediaShadowText: null,
  };
}

// ── AI client interface (relay-adapted — no mod SDK) ────────────────

export type LocalChatGenerateTextInput = {
  prompt: string;
  model?: string;
  route?: string;
  maxTokens?: number;
  temperature?: number;
  agentId?: string;
  subjectUserId?: string;
  abortSignal?: AbortSignal;
  debugLabel?: string;
};

export type LocalChatGenerateTextResult = {
  text: string;
  traceId: string;
  finishReason?: string;
};

export type LocalChatGenerateObjectInput = LocalChatGenerateTextInput & {
  schema?: unknown;
  debugLabel?: string;
};

export type LocalChatGenerateObjectResult<T = unknown> = {
  object: T;
  text: string;
  traceId: string;
};

export type LocalChatStreamTextDelta =
  | { type: 'text_delta'; textDelta: string }
  | { type: 'done'; traceId: string; finishReason: string };

export type LocalChatGenerateImageInput = {
  prompt: string;
  model?: string;
  negativePrompt?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  n?: number;
  agentId?: string;
};

export type LocalChatGenerateImageResult = {
  artifacts: Array<{ uri?: string; base64?: string; mimeType?: string }>;
  traceId: string;
};

export type LocalChatGenerateVideoInput = {
  prompt: string;
  model?: string;
  content?: string;
  mode?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  cameraMotion?: string;
  agentId?: string;
};

export type LocalChatGenerateVideoResult = {
  artifacts: Array<{ uri?: string; base64?: string; mimeType?: string }>;
  traceId: string;
};

export type LocalChatAudioPlaybackSource = {
  uri?: string;
  bytes?: Uint8Array;
  mimeType?: string;
};

export type LocalChatTurnAiClient = {
  generateText(input: LocalChatGenerateTextInput): Promise<LocalChatGenerateTextResult>;
  generateObject<T = unknown>(input: LocalChatGenerateObjectInput): Promise<LocalChatGenerateObjectResult<T>>;
  streamText(input: LocalChatGenerateTextInput): AsyncIterable<LocalChatStreamTextDelta>;
  generateImage(input: LocalChatGenerateImageInput): Promise<LocalChatGenerateImageResult>;
  generateVideo(input: LocalChatGenerateVideoInput): Promise<LocalChatGenerateVideoResult>;
  resolveRoute(input: { routeBinding?: unknown }): Promise<ChatRouteSnapshot | null>;
};

// ── Target data type (replaces mod data.query) ──────────────────────

export type LocalChatTarget = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  dna: {
    identityLines: string[];
    rulesLines: string[];
    replyStyleLines: string[];
  };
  metadata: JsonObject;
  worldId: string | null;
  worldName: string | null;
};

// ── Main process chat context (replaces UseLocalChatTurnSendInput) ──

export type RelayChatTurnSendInput = {
  aiClient: LocalChatTurnAiClient;
  inputText: string;
  viewerId: string;
  viewerDisplayName: string;
  runtimeMode: 'STORY' | 'SCENE_TURN' | undefined;
  routeSnapshot: ChatRouteSnapshot | null;
  defaultSettings: import('../settings/types.js').LocalChatDefaultSettings;
  voiceConversationMode?: VoiceConversationMode;
  selectedTarget: LocalChatTarget | null;
  selectedSessionId: string;
  messages: ChatMessage[];
  isTranscribing?: boolean;
  onSessionResolved?: (sessionId: string) => void;
  synthesizeVoice?: (text: string) => Promise<LocalChatAudioPlaybackSource>;
};
