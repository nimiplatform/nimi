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
  model?: string;
  size?: string;
  n?: number;
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type InvokeModImageOutput = {
  images: Array<{ uri?: string; b64Json?: string; mimeType?: string }>;
};

export type InvokeModVideoInput = {
  modId: string;
  provider: string;
  prompt: string;
  model?: string;
  durationSeconds?: number;
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type InvokeModVideoOutput = {
  videos: Array<{ uri?: string; mimeType?: string }>;
};

export type InvokeModTranscribeOutput = {
  text: string;
};

export type InvokeModLlmStreamEvent =
  | {
      type: 'text_delta';
      textDelta: string;
    }
  | {
      type: 'done';
    };
