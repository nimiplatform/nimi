# SDK vNext TypeScript 接口规范草案（Runtime + Realm Only）

- 日期：2026-02-27
- 目标：给出可评审的代码级接口合同。
- 范围：`Runtime`、`Realm` 与公共类型（无 `NimiApp`）。

## 0. 设计约束（必须满足）

1. 主线对象固定为 `Runtime` 与 `Realm` 两个 class；不引入第三聚合客户端。
2. vNext 接口必须覆盖当前 SDK 已有能力，不允许能力回退（runtime `auth/appAuth/ai/workflow/model/localRuntime/knowledge/app/audit/closeStream`；realm generated services；scope）。
3. 默认用户体验为懒连接（auto），并保留显式 `connect/ready/close`（预热与释放）。
4. 跨域流程采用显式值传递，不共享可变全局状态。
5. Realm 配置必须实例隔离，禁止写入全局 `OpenAPI` 单例。

## 1. 顶层导出（Proposal）

```ts
export {
  Runtime,
  Realm,
  NimiError,
};

export type {
  RuntimeOptions,
  RuntimeConnectionMode,
  RuntimeConnectionState,
  RuntimeHealth,
  RealmOptions,
  RealmConnectionState,
  RealmServiceRegistry,
  NimiErrorCode,
  NimiRoutePolicy,
  NimiFallbackPolicy,
  NimiEventName,
  RuntimeRealmBridgeContext,
};
```

## 2. Runtime 客户端

```ts
export class Runtime {
  constructor(options: RuntimeOptions);

  readonly appId: string;
  readonly auth: RuntimeAuthModule;
  readonly appAuth: RuntimeAppAuthModule;
  readonly ai: RuntimeAiModule;
  readonly media: RuntimeMediaModule;
  readonly workflow: RuntimeWorkflowModule;
  readonly model: RuntimeModelModule;
  readonly localRuntime: RuntimeLocalRuntimeModule;
  readonly knowledge: RuntimeKnowledgeModule;
  readonly app: RuntimeAppModule;
  readonly audit: RuntimeAuditModule;
  readonly scope: RuntimeScopeModule;
  readonly events: NimiEventsModule;
  readonly raw: RuntimeRawModule;

  connect(): Promise<void>;
  ready(input?: { timeoutMs?: number }): Promise<void>;
  close(input?: { force?: boolean }): Promise<void>;

  state(): RuntimeConnectionState;
  health(): Promise<RuntimeHealth>;

  call<TReq, TRes>(
    method: RuntimeMethod<TReq, TRes>,
    input: TReq,
    options?: RuntimeCallOptions,
  ): Promise<TRes>;
}

export type RuntimeConnectionMode = 'auto' | 'manual';

export type RuntimeOptions = {
  appId: string;
  connection?: {
    mode?: RuntimeConnectionMode; // default: auto
  };
  transport:
    | {
        type: 'node-grpc';
        endpoint: string;
        tls?: {
          enabled?: boolean;
          serverName?: string;
          rootCertPem?: string;
        };
      }
    | {
        type: 'tauri-ipc';
        commandNamespace?: string;
        eventNamespace?: string;
      };
  defaults?: {
    protocolVersion?: string;
    participantProtocolVersion?: string;
    participantId?: string;
    callerKind?: 'desktop-core' | 'desktop-mod' | 'third-party-app' | 'third-party-service';
    callerId?: string;
    surfaceId?: string;
  };
  timeoutMs?: number;
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  telemetry?: {
    enabled?: boolean;
    onEvent?: (event: NimiTelemetryEvent) => void;
  };
};

export type RuntimeConnectionState = {
  status: 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
  connectedAt?: string;
  lastReadyAt?: string;
};
```

## 3. Realm 客户端

```ts
export class Realm {
  constructor(options: RealmOptions);

  readonly auth: RealmAuthApi;
  readonly users: RealmUserApi;
  readonly posts: RealmPostApi;
  readonly worlds: RealmWorldApi;
  readonly notifications: RealmNotificationApi;
  readonly media: RealmMediaApi;
  readonly search: RealmSearchApi;
  readonly transits: RealmTransitsApi;
  readonly services: RealmServiceRegistry; // generated services 全量透传
  readonly events: NimiEventsModule;
  readonly raw: RealmRawModule;

  connect(): Promise<void>;
  ready(input?: { timeoutMs?: number }): Promise<void>;
  close(input?: { force?: boolean }): Promise<void>;

  state(): RealmConnectionState;
}

export type RealmOptions = {
  baseUrl: string;
  auth?: {
    accessToken?: string | (() => Promise<string>);
    refreshToken?: string | (() => Promise<string>);
  };
  headers?: Record<string, string> | (() => Promise<Record<string, string>>);
  timeoutMs?: number;
  telemetry?: {
    enabled?: boolean;
    onEvent?: (event: NimiTelemetryEvent) => void;
  };
};

export type RealmConnectionState = {
  status: 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
  connectedAt?: string;
  lastReadyAt?: string;
};
```

约束：`Realm` 必须实例隔离，禁止全局配置写入。

## 4. 应用跨域编排（非客户端对象）

```ts
export type RuntimeRealmBridgeContext = {
  appId: string;
  runtime: Runtime;
  realm: Realm;
};

export type RuntimeRealmBridgeHelpers = {
  fetchRealmGrant(input: {
    appId: string;
    subjectUserId: string;
    scopes: string[];
  }): Promise<{
    token: string;
    version: string;
    expiresAt?: string;
  }>;

  buildRuntimeAuthMetadata(input: {
    grantToken: string;
    grantVersion: string;
  }): Record<string, string>;

  linkRuntimeTraceToRealmWrite(input: {
    runtimeTraceId?: string;
    realmPayload: Record<string, unknown>;
  }): Record<string, unknown>;
};
```

说明：

1. 跨域流程由应用自行编排。
2. SDK 可提供 helper types / pure helpers，不提供第三客户端对象。
3. `DONE` helper types / pure helpers 已落地：`sdk/src/runtime/vnext-types.ts`、`sdk/src/runtime/runtime-realm-bridge.ts`（含导出与测试）。

## 5. Runtime / Realm 模块面（补齐）

```ts
export type RuntimeAuthModule = {
  registerApp(input: RegisterAppRequest, options?: RuntimeCallOptions): Promise<RegisterAppResponse>;
  openSession(input: OpenSessionRequest, options?: RuntimeCallOptions): Promise<OpenSessionResponse>;
  refreshSession(input: RefreshSessionRequest, options?: RuntimeCallOptions): Promise<RefreshSessionResponse>;
  revokeSession(input: RevokeSessionRequest, options?: RuntimeCallOptions): Promise<Ack>;
  registerExternalPrincipal(input: RegisterExternalPrincipalRequest, options?: RuntimeCallOptions): Promise<RegisterExternalPrincipalResponse>;
  openExternalPrincipalSession(input: OpenExternalPrincipalSessionRequest, options?: RuntimeCallOptions): Promise<OpenExternalPrincipalSessionResponse>;
  revokeExternalPrincipalSession(input: RevokeExternalPrincipalSessionRequest, options?: RuntimeCallOptions): Promise<Ack>;
};

export type RuntimeAppAuthModule = {
  authorizeExternalPrincipal(input: AuthorizeExternalPrincipalRequest, options?: RuntimeCallOptions): Promise<AuthorizeExternalPrincipalResponse>;
  validateToken(input: ValidateAppAccessTokenRequest, options?: RuntimeCallOptions): Promise<ValidateAppAccessTokenResponse>;
  revokeToken(input: RevokeAppAccessTokenRequest, options?: RuntimeCallOptions): Promise<Ack>;
  issueDelegatedToken(input: IssueDelegatedAccessTokenRequest, options?: RuntimeCallOptions): Promise<IssueDelegatedAccessTokenResponse>;
  listTokenChain(input: ListTokenChainRequest, options?: RuntimeCallOptions): Promise<ListTokenChainResponse>;
};

export type RuntimeAiModule = {
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

export type RuntimeAppModule = {
  sendMessage(input: RuntimeAppMessageInput): Promise<RuntimeAppMessageOutput>;
  subscribeMessages(input: RuntimeAppMessageSubscribeInput): Promise<AsyncIterable<RuntimeAppMessageEvent>>;
};

export type RuntimeWorkflowModule = {
  submit(input: SubmitWorkflowRequest, options?: RuntimeCallOptions): Promise<SubmitWorkflowResponse>;
  get(input: GetWorkflowRequest, options?: RuntimeCallOptions): Promise<GetWorkflowResponse>;
  cancel(input: CancelWorkflowRequest, options?: RuntimeCallOptions): Promise<Ack>;
  subscribeEvents(input: SubscribeWorkflowEventsRequest, options?: RuntimeCallOptions): Promise<AsyncIterable<WorkflowEvent>>;
};

export type RuntimeModelModule = {
  list(input: ListModelsRequest, options?: RuntimeCallOptions): Promise<ListModelsResponse>;
  pull(input: PullModelRequest, options?: RuntimeCallOptions): Promise<PullModelResponse>;
  remove(input: RemoveModelRequest, options?: RuntimeCallOptions): Promise<Ack>;
  checkHealth(input: CheckModelHealthRequest, options?: RuntimeCallOptions): Promise<CheckModelHealthResponse>;
};

export type RuntimeLocalRuntimeModule = {
  listLocalModels(input: ListLocalModelsRequest, options?: RuntimeCallOptions): Promise<ListLocalModelsResponse>;
  listVerifiedModels(input: ListVerifiedModelsRequest, options?: RuntimeCallOptions): Promise<ListVerifiedModelsResponse>;
  searchCatalogModels(input: SearchCatalogModelsRequest, options?: RuntimeCallOptions): Promise<SearchCatalogModelsResponse>;
  resolveModelInstallPlan(input: ResolveModelInstallPlanRequest, options?: RuntimeCallOptions): Promise<ResolveModelInstallPlanResponse>;
  installLocalModel(input: InstallLocalModelRequest, options?: RuntimeCallOptions): Promise<InstallLocalModelResponse>;
  installVerifiedModel(input: InstallVerifiedModelRequest, options?: RuntimeCallOptions): Promise<InstallVerifiedModelResponse>;
  importLocalModel(input: ImportLocalModelRequest, options?: RuntimeCallOptions): Promise<ImportLocalModelResponse>;
  removeLocalModel(input: RemoveLocalModelRequest, options?: RuntimeCallOptions): Promise<RemoveLocalModelResponse>;
  startLocalModel(input: StartLocalModelRequest, options?: RuntimeCallOptions): Promise<StartLocalModelResponse>;
  stopLocalModel(input: StopLocalModelRequest, options?: RuntimeCallOptions): Promise<StopLocalModelResponse>;
  checkLocalModelHealth(input: CheckLocalModelHealthRequest, options?: RuntimeCallOptions): Promise<CheckLocalModelHealthResponse>;
  collectDeviceProfile(input: CollectDeviceProfileRequest, options?: RuntimeCallOptions): Promise<CollectDeviceProfileResponse>;
  resolveDependencies(input: ResolveDependenciesRequest, options?: RuntimeCallOptions): Promise<ResolveDependenciesResponse>;
  applyDependencies(input: ApplyDependenciesRequest, options?: RuntimeCallOptions): Promise<ApplyDependenciesResponse>;
  listLocalServices(input: ListLocalServicesRequest, options?: RuntimeCallOptions): Promise<ListLocalServicesResponse>;
  installLocalService(input: InstallLocalServiceRequest, options?: RuntimeCallOptions): Promise<InstallLocalServiceResponse>;
  startLocalService(input: StartLocalServiceRequest, options?: RuntimeCallOptions): Promise<StartLocalServiceResponse>;
  stopLocalService(input: StopLocalServiceRequest, options?: RuntimeCallOptions): Promise<StopLocalServiceResponse>;
  checkLocalServiceHealth(input: CheckLocalServiceHealthRequest, options?: RuntimeCallOptions): Promise<CheckLocalServiceHealthResponse>;
  removeLocalService(input: RemoveLocalServiceRequest, options?: RuntimeCallOptions): Promise<RemoveLocalServiceResponse>;
  listNodeCatalog(input: ListNodeCatalogRequest, options?: RuntimeCallOptions): Promise<ListNodeCatalogResponse>;
  listLocalAudits(input: ListLocalAuditsRequest, options?: RuntimeCallOptions): Promise<ListLocalAuditsResponse>;
  appendInferenceAudit(input: AppendInferenceAuditRequest, options?: RuntimeCallOptions): Promise<Ack>;
  appendRuntimeAudit(input: AppendRuntimeAuditRequest, options?: RuntimeCallOptions): Promise<Ack>;
};

export type RuntimeKnowledgeModule = {
  buildIndex(input: BuildIndexRequest, options?: RuntimeCallOptions): Promise<BuildIndexResponse>;
  searchIndex(input: SearchIndexRequest, options?: RuntimeCallOptions): Promise<SearchIndexResponse>;
  deleteIndex(input: DeleteIndexRequest, options?: RuntimeCallOptions): Promise<Ack>;
};

export type RuntimeAuditModule = {
  listAuditEvents(input: ListAuditEventsRequest, options?: RuntimeCallOptions): Promise<ListAuditEventsResponse>;
  exportAuditEvents(input: ExportAuditEventsRequest, options?: RuntimeCallOptions): Promise<AsyncIterable<AuditExportChunk>>;
  listUsageStats(input: ListUsageStatsRequest, options?: RuntimeCallOptions): Promise<ListUsageStatsResponse>;
  getRuntimeHealth(input?: GetRuntimeHealthRequest, options?: RuntimeCallOptions): Promise<GetRuntimeHealthResponse>;
  listAIProviderHealth(input: ListAIProviderHealthRequest, options?: RuntimeCallOptions): Promise<ListAIProviderHealthResponse>;
  subscribeAIProviderHealthEvents(input: SubscribeAIProviderHealthEventsRequest, options?: RuntimeCallOptions): Promise<AsyncIterable<AIProviderHealthEvent>>;
  subscribeRuntimeHealthEvents(input?: SubscribeRuntimeHealthEventsRequest, options?: RuntimeCallOptions): Promise<AsyncIterable<RuntimeHealthEvent>>;
};

export type RuntimeRawModule = {
  call<TReq, TRes>(methodId: string, input: TReq, options?: RuntimeCallOptions): Promise<TRes>;
  closeStream(streamId: string): Promise<void>;
};

export type RealmRawModule = {
  request<T = unknown>(input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<T>;
};

export type RealmServiceHandle = Record<string, (...args: unknown[]) => Promise<unknown>>;
export type RealmServiceRegistry = Record<string, RealmServiceHandle>;

export type RealmAuthApi = RealmServiceHandle;
export type RealmUserApi = RealmServiceHandle;
export type RealmPostApi = RealmServiceHandle;
export type RealmWorldApi = RealmServiceHandle;
export type RealmNotificationApi = RealmServiceHandle;
export type RealmMediaApi = RealmServiceHandle;
export type RealmSearchApi = RealmServiceHandle;
export type RealmTransitsApi = RealmServiceHandle;

export type RuntimeMethod<TReq, TRes> = {
  methodId: string;
  kind?: 'unary' | 'stream';
};

export type RuntimeCallOptions = {
  timeoutMs?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
  metadata?: {
    protocolVersion?: string;
    participantProtocolVersion?: string;
    participantId?: string;
    domain?: string;
    appId?: string;
    traceId?: string;
    callerKind?: 'desktop-core' | 'desktop-mod' | 'third-party-app' | 'third-party-service';
    callerId?: string;
    surfaceId?: string;
    extra?: Record<string, string>;
  };
};
```

说明：

1. `*Request/*Response/Ack` 类型沿用 runtime 协议类型包（由 SDK 内部统一导出），不直接暴露 generated 深层路径。
2. `realm.services` 提供全量能力透传；`realm.auth/users/posts/...` 提供稳定命名 facade。

## 6. 请求/响应类型（核心）

```ts
export type TextGenerateInput = {
  model: string;
  input: string | TextMessage[];
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

export type TextMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
};

export type TextGenerateOutput = {
  text: string;
  finishReason: NimiFinishReason;
  usage: NimiTokenUsage;
  trace: NimiTraceInfo;
};

export type TextStreamOutput = {
  stream: AsyncIterable<TextStreamPart>;
  close?: () => Promise<void>;
};

export type TextStreamPart =
  | { type: 'start' }
  | { type: 'delta'; text: string }
  | { type: 'finish'; finishReason: NimiFinishReason; usage: NimiTokenUsage; trace: NimiTraceInfo }
  | { type: 'error'; error: NimiError };

export type EmbeddingGenerateInput = {
  model: string;
  input: string | string[];
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
};

export type EmbeddingGenerateOutput = {
  vectors: number[][];
  usage: NimiTokenUsage;
  trace: NimiTraceInfo;
};

export type ArtifactChunk = {
  artifactId: string;
  mimeType: string;
  sequence: string;
  chunk: Uint8Array;
  eof: boolean;
  usage?: NimiTokenUsage;
  trace?: NimiTraceInfo;
};

export type MediaJobSubmitInput =
  | { modal: 'image'; input: ImageGenerateInput }
  | { modal: 'video'; input: VideoGenerateInput }
  | { modal: 'tts'; input: SpeechSynthesizeInput }
  | { modal: 'stt'; input: SpeechTranscribeInput };

export type RuntimeAppMessageInput = {
  appId: string;
  channel: string;
  topic?: string;
  payload: Record<string, unknown>;
};

export type RuntimeAppMessageOutput = {
  accepted: boolean;
  messageId?: string;
  trace?: NimiTraceInfo;
};

export type RuntimeAppMessageSubscribeInput = {
  appId: string;
  channel?: string;
  topic?: string;
};

export type RuntimeAppMessageEvent = {
  messageId: string;
  channel: string;
  topic?: string;
  payload: Record<string, unknown>;
  at: string;
};
```

```ts
export type ImageGenerateInput = {
  model: string;
  prompt: string;
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
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type VideoGenerateInput = {
  model: string;
  prompt: string;
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
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type SpeechSynthesizeInput = {
  model: string;
  text: string;
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
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type SpeechTranscribeInput = {
  model: string;
  audio: { kind: 'bytes'; bytes: Uint8Array }
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
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
};
```

```ts
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
```

## 7. 任务与工件

```ts
export type MediaJobStatus =
  | 'SUBMITTED'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'TIMEOUT';

export type MediaJob = {
  jobId: string;
  appId?: string;
  subjectUserId?: string;
  modelId: string;
  status: MediaJobStatus;
  modal: 'image' | 'video' | 'tts' | 'stt';
  routePolicy?: NimiRoutePolicy;
  routeDecision?: NimiRoutePolicy;
  modelResolved?: string;
  providerJobId?: string;
  retryCount?: number;
  createdAt: string;
  updatedAt: string;
  nextPollAt?: string;
  reasonCode?: string;
  reasonDetail?: string;
  traceId?: string;
  usage?: NimiTokenUsage;
};

export type MediaJobEvent = {
  jobId: string;
  status: MediaJobStatus;
  eventType?: 'SNAPSHOT' | 'UPDATED' | 'ARTIFACT' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  sequence: string;
  at: string;
  traceId?: string;
  job?: MediaJob;
  reasonCode?: string;
  reasonDetail?: string;
};

export type MediaArtifact = {
  artifactId: string;
  uri?: string;
  bytes?: Uint8Array;
  mimeType: string;
  sizeBytes?: number;
  sha256?: string;
  durationMs?: number;
  fps?: number;
  width?: number;
  height?: number;
  sampleRateHz?: number;
  channels?: number;
  providerRaw?: Record<string, unknown>;
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
```

## 8. Scope/Auth（Runtime 内 + 应用显式编排）

```ts
export type RuntimeScopeModule = {
  register(input: ScopeManifestInput): Promise<ScopeDraft>;
  publish(): Promise<ScopePublished>;
  revoke(input: { scopes: string[] }): Promise<ScopeRevoked>;
  list(input?: ScopeListInput): Promise<ScopeCatalogSnapshot>;
};

export type ScopeManifestInput = {
  manifestVersion: string;
  scopes: string[];
};

export type ScopeListInput = {
  include?: Array<'realm' | 'runtime' | 'app'>;
};

export type ScopeDraft = {
  scopeCatalogVersion: string;
  catalogHash: string;
  status: 'draft';
  scopes: string[];
};

export type ScopePublished = {
  scopeCatalogVersion: string;
  catalogHash: string;
  status: 'published';
  scopes: string[];
  publishedAt: string;
};

export type ScopeRevoked = {
  scopeCatalogVersion: string;
  status: 'revoked';
  revokedScopes: string[];
  reauthorizeRequired: true;
};

export type ScopeCatalogSnapshot = {
  appId: string;
  realmScopes: string[];
  runtimeScopes: string[];
  appScopes: string[];
  draft: ScopeDraft | null;
  published: ScopePublished | null;
  revokedScopes: string[];
};
```

规则补充：

1. `runtime.scope` 为异步 facade（便于未来接入远端 scope service），默认实现可包装当前 SDK 的本地 scope 模块。
2. `runtime.appAuth.authorizeExternalPrincipal` 必须内建 `resolvePublishedCatalogVersion` 逻辑，拒绝未发布/已撤销版本。

## 9. 事件与错误

```ts
export type NimiEventsModule = {
  on<TName extends NimiEventName>(name: TName, handler: (event: NimiEventPayloadMap[TName]) => void): () => void;
  once<TName extends NimiEventName>(name: TName, handler: (event: NimiEventPayloadMap[TName]) => void): () => void;
};

export type NimiEventName =
  | 'runtime.connected'
  | 'runtime.disconnected'
  | 'ai.route.decision'
  | 'media.job.status'
  | 'auth.token.issued'
  | 'auth.token.revoked'
  | 'error';

export type NimiEventPayloadMap = {
  'runtime.connected': { at: string };
  'runtime.disconnected': { at: string; reasonCode?: string };
  'ai.route.decision': { route: NimiRoutePolicy; model: string; traceId?: string };
  'media.job.status': { jobId: string; status: MediaJobStatus; at: string };
  'auth.token.issued': { tokenId: string; at: string };
  'auth.token.revoked': { tokenId: string; at: string };
  error: { error: NimiError; at: string };
};

export class NimiError extends Error {
  readonly code: NimiErrorCode;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: 'sdk' | 'runtime' | 'realm';
  readonly traceId?: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown> & {
    rawReasonCode?: string;
  };
}

export type NimiErrorCode =
  | 'CONFIG_INVALID'
  | 'APP_ID_REQUIRED'
  | 'RUNTIME_UNAVAILABLE'
  | 'REALM_UNAVAILABLE'
  | 'AUTH_DENIED'
  | 'SCOPE_UNPUBLISHED'
  | 'SCOPE_REVOKED'
  | 'AI_INPUT_INVALID'
  | 'AI_ROUTE_UNSUPPORTED'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'MEDIA_JOB_FAILED'
  | 'MEDIA_JOB_TIMEOUT'
  | 'OPERATION_ABORTED'
  | 'PROTOCOL_MISMATCH'
  | 'INTERNAL_ERROR';

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

export type NimiTelemetryEvent = {
  name: string;
  at: string;
  data?: Record<string, unknown>;
};
```

映射规则：

1. `code` 是 SDK 稳定语义码（面向应用逻辑判断）。
2. `reasonCode` 是链路最近一跳的原因码（优先 runtime/realm 返回）。
3. 若存在 provider/下游原始码，放入 `details.rawReasonCode`。

## 10. 评审锚点

1. `Runtime` 与 `Realm` 的模块命名是否足够稳定。
2. 跨域场景是否只依赖显式编排，不引入聚合客户端。
3. 错误码是否采用 SDK 语义码 + details.reasonCode 映射策略。
4. `Runtime.call` 是否保留为低级 escape hatch。
5. runtime 当前能力是否 1:1 覆盖（含 `app`、`closeStream`、`workflow-builder`）。
6. realm 是否同时提供稳定 facade + `services` 全量透传。
7. scope 能力是否并入 `runtime.scope` 且不丢失现有校验行为。

## 11. 显式调用范式（推荐）

1. `Realm -> Runtime`：先调用 realm 获取授信材料，再把材料显式注入 runtime metadata。
2. `Runtime -> Realm`：把 runtime 输出（artifact/traceId）显式写回 realm，失败时走补偿策略。
3. `双向预检`：realm policy 与 runtime health 并行检查后再执行主调用。

### 11.1 边界硬约束

1. `Runtime` 与 `Realm` 生命周期独立：`connect/ready/close` 分别调用，不互相代理。
2. 鉴权域独立：Realm 负责 auth/grant，Runtime 只消费显式传入的授信材料。
3. 状态独立：禁止共享可变全局状态；跨域只允许“值传递”（input/output/metadata）。
4. 失败独立：Realm 错误与 Runtime 错误不得合并吞掉；必须保留原始错误源和 trace。

### 11.2 推荐编排模板

```ts
export async function runTextWithRealmGrant(input: {
  runtime: Runtime;
  realm: Realm;
  appId: string;
  subjectUserId: string;
  model: string;
  text: string;
}) {
  const grant = await input.realm.raw.request<{ token: string; version: string }>({
    method: 'POST',
    path: '/api/creator/mods/control/grants/issue',
    body: {
      appId: input.appId,
      subjectUserId: input.subjectUserId,
      scopes: ['ai.text.generate'],
    },
  });

  const result = await input.runtime.ai.text.generate({
    model: input.model,
    input: input.text,
    metadata: {
      realmGrantToken: grant.token,
      realmGrantVersion: grant.version,
    },
  });

  await input.realm.posts.create({
    content: result.text,
    traceId: result.trace.traceId,
  });

  return result;
}
```

## 12. 现有 SDK 覆盖矩阵（重构验收门槛）

### 12.1 Runtime 能力映射（不得遗漏）

1. `auth.*` -> `runtime.auth.*`
2. `appAuth.*` -> `runtime.appAuth.*`
3. `ai.generate/streamGenerate/embed` -> `runtime.ai.text.* / runtime.ai.embedding.generate`
4. `ai.submitMediaJob/getMediaJob/cancelMediaJob/subscribeMediaJobEvents/getMediaArtifacts` -> `runtime.media.jobs.*`
5. `ai.generateImage/generateVideo/synthesizeSpeech/transcribeAudio` -> `runtime.media.image|video|tts|stt.*`
6. `workflow.*` -> `runtime.workflow.*`
7. `model.*` -> `runtime.model.*`
8. `localRuntime.*` -> `runtime.localRuntime.*`
9. `knowledge.*` -> `runtime.knowledge.*`
10. `app.sendAppMessage/subscribeAppMessages` -> `runtime.app.*`
11. `audit.*` -> `runtime.audit.*`
12. `closeStream` -> `runtime.raw.closeStream`

### 12.2 Realm 能力映射（不得遗漏）

1. 稳定高频 facade：`auth/users/posts/worlds/notifications/media/search/transits`
2. 全量 generated services 透传：`realm.services.*`
3. 低级请求逃生口：`realm.raw.request`
4. 规范命名 alias（如 `TwoFactor`）必须在 facade 层保持一致，不向上泄露 legacy 命名

### 12.3 Scope 能力映射（不得遗漏）

1. `listCatalog/registerAppScopes/publishCatalog/revokeAppScopes/resolvePublishedCatalogVersion` 全量并入 `runtime.scope`
2. `authorizeExternalPrincipal` 必须复用 `resolvePublishedCatalogVersion` 的发布态校验
3. 语义保持：未发布/已撤销/版本冲突必须输出稳定错误码

### 12.4 验收清单（Release Blocker）

1. 任一现有 public 方法缺失，阻断发布。
2. 存在全局 `OpenAPI` 污染路径，阻断发布。
3. `createNimiClient` 仍作为主入口，阻断发布。
4. 示例代码无法仅用 `new Runtime()` / `new Realm()` 跑通，阻断发布。
