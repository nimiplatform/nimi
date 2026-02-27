export const DEFAULT_LOCAL_RUNTIME_ENDPOINT = 'http://127.0.0.1:1234/v1';
export const DEFAULT_OPENAI_ENDPOINT = 'http://127.0.0.1:1234/v1';
export const PRIVATE_PROVIDER_TIMEOUT_MS = 60_000;

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ProviderKind = 'OPENAI_COMPATIBLE' | 'LOCALAI_NATIVE' | 'FALLBACK';
export type ProviderNamespace = 'localai' | 'nexa' | string;

export type LocalAiProviderHints = {
  localai?: {
    backend?: string;
    preferredAdapter?: 'openai_compat_adapter' | 'localai_native_adapter' | string;
    whisperVariant?: string;
    stablediffusionPipeline?: string;
    videoBackend?: string;
  };
  nexa?: {
    backend?: string;
    preferredAdapter?: 'openai_compat_adapter' | 'localai_native_adapter' | string;
    pluginId?: string;
    deviceId?: string;
    modelType?: string;
    npuMode?: string;
    policyGate?: string;
    hostNpuReady?: boolean;
    modelProbeHasNpuCandidate?: boolean;
    policyGateAllowsNpu?: boolean;
    npuUsable?: boolean;
    gateReason?: string;
    gateDetail?: string;
  };
} & Record<string, unknown>;

export type ProviderPlan = {
  providerKind: ProviderKind;
  providerNamespace: ProviderNamespace;
  providerRef: string;
  modelHint: string;
  endpoint: string | null;
  model: string;
  adapter: 'openai_compat_adapter' | 'localai_native_adapter';
  providerHints?: LocalAiProviderHints;
};

export type ProviderHealth = {
  providerKind: ProviderKind;
  provider: string;
  endpoint: string | null;
  model: string;
  status: 'healthy' | 'unsupported' | 'unreachable';
  detail: string;
  checkedAt: string;
};

export type CheckLlmHealthInput = {
  provider: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  credentialRefId?: string;
  providerHints?: LocalAiProviderHints;
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
  credentialRefId?: string;
  providerHints?: LocalAiProviderHints;
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
  credentialRefId?: string;
  providerHints?: LocalAiProviderHints;
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
  credentialRefId?: string;
  providerHints?: LocalAiProviderHints;
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
  credentialRefId?: string;
  providerHints?: LocalAiProviderHints;
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
  credentialRefId?: string;
  providerHints?: LocalAiProviderHints;
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
  credentialRefId?: string;
  providerHints?: LocalAiProviderHints;
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
