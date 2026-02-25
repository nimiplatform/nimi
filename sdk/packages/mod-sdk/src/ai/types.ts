import type {
  RuntimeRouteHealthResult,
  RuntimeRouteHint,
  RuntimeRouteOverride,
  ResolvedRuntimeRouteBinding,
} from '../types';

export type AiRouteInput = {
  routeHint?: RuntimeRouteHint;
  routeOverride?: RuntimeRouteOverride;
};

export type AiTextRequest = AiRouteInput & {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  mode?: 'STORY' | 'SCENE_TURN';
  worldId?: string;
  agentId?: string;
  abortSignal?: AbortSignal;
};

export type AiTextResult = {
  text: string;
  promptTraceId: string;
  route: ResolvedRuntimeRouteBinding;
};

export type AiStreamTextEvent =
  | { type: 'text_delta'; textDelta: string; route: ResolvedRuntimeRouteBinding }
  | { type: 'done'; route: ResolvedRuntimeRouteBinding };

export type AiGenerateObjectRequest = AiTextRequest & {
  parse?: (text: string) => Record<string, unknown>;
};

export type AiGenerateImageRequest = AiRouteInput & {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
};

export type AiGenerateImageResult = {
  images: Array<{
    uri?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
  route: ResolvedRuntimeRouteBinding;
};

export type AiGenerateVideoRequest = AiRouteInput & {
  prompt: string;
  model?: string;
  durationSeconds?: number;
};

export type AiGenerateVideoResult = {
  videos: Array<{
    uri?: string;
    mimeType?: string;
  }>;
  route: ResolvedRuntimeRouteBinding;
};

export type AiTranscribeAudioRequest = AiRouteInput & {
  audioUri?: string;
  audioBase64?: string;
  mimeType?: string;
  language?: string;
};

export type AiTranscribeAudioResult = {
  text: string;
  route: ResolvedRuntimeRouteBinding;
};

export type AiGenerateEmbeddingRequest = AiRouteInput & {
  input: string | string[];
  model?: string;
};

export type AiGenerateEmbeddingResult = {
  embeddings: number[][];
  route: ResolvedRuntimeRouteBinding;
};

export type AiSynthesizeSpeechRequest = AiRouteInput & {
  text: string;
  providerId?: string;
  routeSource?: 'auto' | 'local-runtime' | 'token-api';
  connectorId?: string;
  voiceId: string;
  format?: 'mp3' | 'wav' | 'opus' | 'pcm';
  speakingRate?: number;
  pitch?: number;
  sampleRateHz?: number;
  language?: string;
  stylePrompt?: string;
  targetId?: string;
  sessionId?: string;
};

export type AiSynthesizeSpeechResult = {
  audioUri: string;
  mimeType: string;
  durationMs?: number;
  sampleRateHz?: number;
  providerTraceId?: string;
  cacheKey?: string;
  route: ResolvedRuntimeRouteBinding;
};

export type ModAiClient = {
  resolveRoute: (input?: AiRouteInput) => Promise<ResolvedRuntimeRouteBinding>;
  checkRouteHealth: (input?: AiRouteInput) => Promise<RuntimeRouteHealthResult>;
  generateText: (input: AiTextRequest) => Promise<AiTextResult>;
  streamText: (input: AiTextRequest) => AsyncIterable<AiStreamTextEvent>;
  generateObject: (input: AiGenerateObjectRequest) => Promise<{
    object: Record<string, unknown>;
    text: string;
    promptTraceId: string;
    route: ResolvedRuntimeRouteBinding;
  }>;
  generateImage: (input: AiGenerateImageRequest) => Promise<AiGenerateImageResult>;
  generateVideo: (input: AiGenerateVideoRequest) => Promise<AiGenerateVideoResult>;
  transcribeAudio: (input: AiTranscribeAudioRequest) => Promise<AiTranscribeAudioResult>;
  generateEmbedding: (input: AiGenerateEmbeddingRequest) => Promise<AiGenerateEmbeddingResult>;
  synthesizeSpeech: (input: AiSynthesizeSpeechRequest) => Promise<AiSynthesizeSpeechResult>;
};

export type AiRuntimeDependencyEntry = {
  dependencyId: string;
  kind: 'model' | 'service' | 'node';
  capability?: string;
  required: boolean;
  selected: boolean;
  preferred: boolean;
  modelId?: string;
  repo?: string;
  engine?: string;
  serviceId?: string;
  nodeId?: string;
  reasonCode?: string;
  warnings: string[];
};

export type AiRuntimeRepairAction = {
  actionId: string;
  label: string;
  reasonCode: string;
  dependencyId?: string;
  capability?: string;
};

export type AiRuntimeDependencySnapshot = {
  modId: string;
  planId?: string;
  status: 'ready' | 'missing' | 'degraded';
  routeSource: 'local-runtime' | 'token-api' | 'mixed' | 'unknown';
  reasonCode?: string;
  warnings: string[];
  dependencies: AiRuntimeDependencyEntry[];
  repairActions: AiRuntimeRepairAction[];
  updatedAt: string;
};

export type ModAiRuntimeInspector = {
  getDependencySnapshot: (capability?: string, routeSourceHint?: 'token-api' | 'local-runtime') => Promise<AiRuntimeDependencySnapshot>;
  getRepairActions: (capability?: string) => Promise<AiRuntimeRepairAction[]>;
};
