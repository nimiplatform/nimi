export const PRIVATE_PROVIDER_TIMEOUT_MS = 60_000;

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ProviderHealth = {
  provider: string;
  endpoint: string | null;
  model: string;
  status: 'healthy' | 'degraded' | 'unsupported' | 'unreachable';
  detail: string;
  checkedAt: string;
};

export type CheckLlmHealthInput = {
  provider: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type ExecuteLocalKernelTurnInput = {
  requestId: string;
  sessionId: string;
  turnIndex: number;
  mode: 'STORY' | 'SCENE_TURN' | string;
  userInputText: string;
  provider: string;
  worldId?: string;
  agentId?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type ExecuteLocalKernelTurnResult = Record<string, unknown>;

export type InvokeModLlmInput = {
  modId: string;
  provider: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  mode?: 'STORY' | 'SCENE_TURN';
  worldId?: string;
  agentId?: string;
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type InvokeModLlmOutput = {
  text: string;
  promptTraceId: string;
  traceId: string;
};

export type InvokeModEmbeddingInput = {
  modId: string;
  provider: string;
  input: string | string[];
  model?: string;
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type InvokeModEmbeddingOutput = {
  embeddings: number[][];
  traceId: string;
};

export type InvokeModTranscribeInput = {
  modId: string;
  provider: string;
  model?: string;
  audioUri?: string;
  audioBase64?: string;
  mimeType?: string;
  language?: string;
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type InvokeModImageInput = {
  modId: string;
  provider: string;
  prompt: string;
  negativePrompt?: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  seed?: number;
  n?: number;
  referenceImages?: string[];
  mask?: string;
  responseFormat?: 'url' | 'base64';
  extensions?: Record<string, unknown>;
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type InvokeModImageOutput = {
  images: Array<{ uri?: string; b64Json?: string; mimeType?: string }>;
  traceId: string;
};

export type InvokeModVideoInput = {
  modId: string;
  provider: string;
  mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  content: Array<
    | {
      type: 'text';
      role?: 'prompt';
      text: string;
    }
    | {
      type: 'image_url';
      role: 'first_frame' | 'last_frame' | 'reference_image';
      imageUrl: string;
    }
  >;
  options?: {
    resolution?: string;
    ratio?: string;
    durationSec?: number;
    frames?: number;
    fps?: number;
    seed?: number;
    cameraFixed?: boolean;
    watermark?: boolean;
    generateAudio?: boolean;
    draft?: boolean;
    serviceTier?: string;
    executionExpiresAfterSec?: number;
    returnLastFrame?: boolean;
  };
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type InvokeModVideoOutput = {
  videos: Array<{ uri?: string; mimeType?: string }>;
  traceId: string;
};

export type InvokeModTranscribeOutput = {
  text: string;
  traceId: string;
};

export type InvokeModLlmStreamEvent =
  | {
      type: 'text_delta';
      textDelta: string;
    }
  | {
      type: 'done';
    };
