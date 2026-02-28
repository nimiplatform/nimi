import type {
  ArtifactChunk,
  CancelMediaJobRequest,
  CancelMediaJobResponse,
  EmbedRequest,
  EmbedResponse,
  CheckTokenProviderHealthRequest,
  CheckTokenProviderHealthResponse,
  GenerateRequest,
  GenerateResponse,
  GetMediaArtifactsRequest,
  GetMediaArtifactsResponse,
  GetMediaJobRequest,
  GetMediaJobResponse,
  ListTokenProviderModelsRequest,
  ListTokenProviderModelsResponse,
  MediaArtifact,
  MediaJob,
  MediaJobEvent,
  StreamGenerateEvent,
  StreamGenerateRequest,
  SubmitMediaJobRequest,
  SubmitMediaJobResponse,
  SubscribeMediaJobEventsRequest,
} from './generated/runtime/v1/ai';
import type {
  RuntimeCallOptions,
  RuntimeClientDefaults,
  RuntimeStreamCallOptions,
  RuntimeTransportConfig,
} from './types';
import type {
  ScopeCatalogDescriptor,
  ScopeCatalogEntry,
  ScopeCatalogPublishResult,
  ScopeCatalogRevokeResult,
  ScopeManifest,
  NimiError,
} from '../types/index.js';
import type { Realm } from '../realm/client.js';
import type { Runtime } from './runtime.js';

export type RuntimeConnectionMode = 'auto' | 'manual';

export type RuntimeConnectionState = {
  status: 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
  connectedAt?: string;
  lastReadyAt?: string;
};

export type RuntimeHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
  reason?: string;
  queueDepth?: number;
  activeWorkflows?: number;
  activeInferenceJobs?: number;
  cpuMilli?: string;
  memoryBytes?: string;
  vramBytes?: string;
  sampledAt?: string;
};

export type RuntimeTelemetryEvent = {
  name: string;
  at: string;
  data?: Record<string, unknown>;
};

export type RuntimeAuthContextProvider = {
  subjectUserId?: string;
  getSubjectUserId?: () => string | Promise<string>;
};

export type RuntimeOptions = {
  appId: string;
  connection?: {
    mode?: RuntimeConnectionMode;
    waitForReadyTimeoutMs?: number;
  };
  transport: RuntimeTransportConfig;
  defaults?: RuntimeClientDefaults;
  timeoutMs?: number;
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  authContext?: RuntimeAuthContextProvider;
  telemetry?: {
    enabled?: boolean;
    onEvent?: (event: RuntimeTelemetryEvent) => void;
  };
};

export type RuntimeAuthMaterial = {
  grantToken: string;
  grantVersion: string;
};

export type RuntimeRealmBridgeContext = {
  appId: string;
  runtime: Runtime;
  realm: Realm;
};

export type RuntimeRealmBridgeHelpers = {
  fetchRealmGrant(input: {
    appId?: string;
    subjectUserId: string;
    scopes: string[];
    path?: string;
  }): Promise<{
    token: string;
    version: string;
    expiresAt?: string;
  }>;
  buildRuntimeAuthMetadata(input: RuntimeAuthMaterial): Record<string, string>;
  linkRuntimeTraceToRealmWrite(input: {
    runtimeTraceId?: string;
    realmPayload: Record<string, unknown>;
  }): Record<string, unknown>;
};

export type NimiRoutePolicy = 'local-runtime' | 'token-api';

export type NimiFallbackPolicy = 'deny' | 'allow';

export type NimiFinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'tool-calls'
  | 'error';

export type NimiTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type NimiTraceInfo = {
  traceId?: string;
  modelResolved?: string;
  routeDecision?: NimiRoutePolicy;
};

export type TextMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
};

export type TextGenerateInput = {
  model: string;
  input: string | TextMessage[];
  subjectUserId?: string;
  system?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

export type TextStreamInput = TextGenerateInput & {
  signal?: AbortSignal;
};

export type TextGenerateOutput = {
  text: string;
  finishReason: NimiFinishReason;
  usage: NimiTokenUsage;
  trace: NimiTraceInfo;
};

export type TextStreamPart =
  | { type: 'start' }
  | { type: 'delta'; text: string }
  | { type: 'finish'; finishReason: NimiFinishReason; usage: NimiTokenUsage; trace: NimiTraceInfo }
  | { type: 'error'; error: NimiError };

export type TextStreamOutput = {
  stream: AsyncIterable<TextStreamPart>;
};

export type EmbeddingGenerateInput = {
  model: string;
  input: string | string[];
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

export type EmbeddingGenerateOutput = {
  vectors: number[][];
  usage: NimiTokenUsage;
  trace: NimiTraceInfo;
};

export type ImageGenerateInput = {
  model: string;
  prompt: string;
  subjectUserId?: string;
  negativePrompt?: string;
  n?: number;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  seed?: number;
  referenceImages?: string[];
  mask?: string;
  responseFormat?: 'url' | 'base64';
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type VideoGenerateInput = {
  model: string;
  prompt: string;
  subjectUserId?: string;
  negativePrompt?: string;
  durationSec?: number;
  fps?: number;
  resolution?: string;
  aspectRatio?: string;
  seed?: number;
  firstFrameUri?: string;
  lastFrameUri?: string;
  cameraMotion?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type SpeechSynthesizeInput = {
  model: string;
  text: string;
  subjectUserId?: string;
  voice?: string;
  language?: string;
  audioFormat?: string;
  sampleRateHz?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type SpeechTranscribeInput = {
  model: string;
  subjectUserId?: string;
  audio:
    | { kind: 'bytes'; bytes: Uint8Array }
    | { kind: 'url'; url: string }
    | { kind: 'chunks'; chunks: Uint8Array[] };
  mimeType?: string;
  language?: string;
  timestamps?: boolean;
  diarization?: boolean;
  speakerCount?: number;
  prompt?: string;
  responseFormat?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type ImageGenerateOutput = {
  job: MediaJob;
  artifacts: MediaArtifact[];
  trace: NimiTraceInfo;
};

export type VideoGenerateOutput = {
  job: MediaJob;
  artifacts: MediaArtifact[];
  trace: NimiTraceInfo;
};

export type SpeechSynthesizeOutput = {
  job: MediaJob;
  artifacts: MediaArtifact[];
  trace: NimiTraceInfo;
};

export type SpeechTranscribeOutput = {
  job: MediaJob;
  text: string;
  trace: NimiTraceInfo;
};

export type SpeechListVoicesInput = {
  model: string;
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  metadata?: Record<string, string>;
};

export type SpeechListVoicesOutput = {
  voices: Array<{
    voiceId: string;
    name: string;
    lang: string;
    supportedLangs: string[];
  }>;
  modelResolved: string;
  traceId: string;
};

export type SpeechStreamSynthesisInput = {
  model: string;
  text: string;
  subjectUserId?: string;
  voice?: string;
  language?: string;
  audioFormat?: string;
  sampleRateHz?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
};

export type MediaJobSubmitInput =
  | { modal: 'image'; input: ImageGenerateInput }
  | { modal: 'video'; input: VideoGenerateInput }
  | { modal: 'tts'; input: SpeechSynthesizeInput }
  | { modal: 'stt'; input: SpeechTranscribeInput };

export type RuntimeScopeModule = {
  register(input: ScopeManifest): Promise<ScopeCatalogEntry>;
  publish(): Promise<ScopeCatalogPublishResult>;
  revoke(input: { scopes: string[] }): Promise<ScopeCatalogRevokeResult>;
  list(input?: { include?: Array<'realm' | 'runtime' | 'app'> }): Promise<ScopeCatalogDescriptor>;
};

export type RuntimeAiModule = {
  generate(request: GenerateRequest, options?: RuntimeCallOptions): Promise<GenerateResponse>;
  streamGenerate(
    request: StreamGenerateRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<StreamGenerateEvent>>;
  embed(request: EmbedRequest, options?: RuntimeCallOptions): Promise<EmbedResponse>;
  submitMediaJob(
    request: SubmitMediaJobRequest,
    options?: RuntimeCallOptions,
  ): Promise<SubmitMediaJobResponse>;
  getMediaJob(request: GetMediaJobRequest, options?: RuntimeCallOptions): Promise<GetMediaJobResponse>;
  cancelMediaJob(
    request: CancelMediaJobRequest,
    options?: RuntimeCallOptions,
  ): Promise<CancelMediaJobResponse>;
  subscribeMediaJobEvents(
    request: SubscribeMediaJobEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<MediaJobEvent>>;
  getMediaArtifacts(
    request: GetMediaArtifactsRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetMediaArtifactsResponse>;
  listTokenProviderModels(
    request: ListTokenProviderModelsRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListTokenProviderModelsResponse>;
  checkTokenProviderHealth(
    request: CheckTokenProviderHealthRequest,
    options?: RuntimeCallOptions,
  ): Promise<CheckTokenProviderHealthResponse>;
  text: {
    generate(input: TextGenerateInput): Promise<TextGenerateOutput>;
    stream(input: TextStreamInput): Promise<TextStreamOutput>;
  };
  embedding: {
    generate(input: EmbeddingGenerateInput): Promise<EmbeddingGenerateOutput>;
  };
};

export type RuntimeMediaModule = {
  image: {
    generate(input: ImageGenerateInput): Promise<ImageGenerateOutput>;
    stream(input: ImageGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
  };
  video: {
    generate(input: VideoGenerateInput): Promise<VideoGenerateOutput>;
    stream(input: VideoGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
  };
  tts: {
    synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeOutput>;
    stream(input: SpeechSynthesizeInput): Promise<AsyncIterable<ArtifactChunk>>;
    listVoices(input: SpeechListVoicesInput): Promise<SpeechListVoicesOutput>;
    streamSynthesis(input: SpeechStreamSynthesisInput): Promise<AsyncIterable<ArtifactChunk>>;
  };
  stt: {
    transcribe(input: SpeechTranscribeInput): Promise<SpeechTranscribeOutput>;
  };
  jobs: {
    submit(input: MediaJobSubmitInput): Promise<MediaJob>;
    get(jobId: string): Promise<MediaJob>;
    cancel(input: { jobId: string; reason?: string }): Promise<MediaJob>;
    subscribe(jobId: string): Promise<AsyncIterable<MediaJobEvent>>;
    getArtifacts(jobId: string): Promise<{ artifacts: MediaArtifact[]; traceId?: string }>;
  };
};

export type RuntimeEventName =
  | 'runtime.connected'
  | 'runtime.disconnected'
  | 'ai.route.decision'
  | 'media.job.status'
  | 'auth.token.issued'
  | 'auth.token.revoked'
  | 'error';

export type RuntimeEventPayloadMap = {
  'runtime.connected': { at: string };
  'runtime.disconnected': { at: string; reasonCode?: string };
  'ai.route.decision': { route: NimiRoutePolicy; model: string; traceId?: string };
  'media.job.status': { jobId: string; status: string; at: string };
  'auth.token.issued': { tokenId: string; at: string };
  'auth.token.revoked': { tokenId: string; at: string };
  error: { error: NimiError; at: string };
};

export type RuntimeEventsModule = {
  on<Name extends RuntimeEventName>(
    name: Name,
    handler: (event: RuntimeEventPayloadMap[Name]) => void,
  ): () => void;
  once<Name extends RuntimeEventName>(
    name: Name,
    handler: (event: RuntimeEventPayloadMap[Name]) => void,
  ): () => void;
};

export type RuntimeRawModule = {
  call<TReq, TRes>(
    methodId: string,
    input: TReq,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<TRes>;
  closeStream(streamId: string): Promise<void>;
};

export type RuntimeMethod<TReq, TRes> = {
  methodId: string;
  kind?: 'unary' | 'stream';
};
