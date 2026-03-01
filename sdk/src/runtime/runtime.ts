import { createEventBus } from '../internal/event-bus.js';
import { createScopeModule, type ScopeModule } from '../scope/index.js';
import { ReasonCode, type NimiError } from '../types/index.js';
import { asNimiError, createNimiError } from './errors.js';
import {
  FallbackPolicy,
  FinishReason,
  MediaJobStatus,
  Modal,
  RoutePolicy,
  type ArtifactChunk,
  type CancelMediaJobRequest,
  type GenerateRequest,
  type GenerateResponse,
  type GetMediaArtifactsResponse,
  type GetSpeechVoicesRequest,
  type GetSpeechVoicesResponse,
  type MediaJob,
  type SpeechVoiceDescriptor,
  type StreamGenerateEvent,
  type StreamSpeechSynthesisRequest,
  type SubmitMediaJobRequest,
} from './generated/runtime/v1/ai';
import { RuntimeHealthStatus } from './generated/runtime/v1/audit';
import { Struct } from './generated/google/protobuf/struct.js';
import { RuntimeMethodIds, isRuntimeStreamMethod } from './method-ids.js';
import { createRuntimeClient } from './core/client.js';
import type {
  RuntimeAppAuthClient,
  RuntimeAuditClient,
  RuntimeAuthClient,
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeConnectorClient,
  RuntimeKnowledgeClient,
  RuntimeLocalRuntimeClient,
  RuntimeModelClient,
  RuntimeStreamCallOptions,
  RuntimeTransportConfig,
  RuntimeWorkflowClient,
} from './types.js';
import type {
  EmbeddingGenerateInput,
  EmbeddingGenerateOutput,
  ImageGenerateInput,
  ImageGenerateOutput,
  MediaJobSubmitInput,
  NimiFallbackPolicy,
  NimiFinishReason,
  NimiRoutePolicy,
  NimiTokenUsage,
  NimiTraceInfo,
  RuntimeAiModule,
  RuntimeConnectionMode,
  RuntimeConnectionState,
  RuntimeEventPayloadMap,
  RuntimeEventsModule,
  RuntimeHealth,
  RuntimeMediaModule,
  RuntimeMethod,
  RuntimeOptions,
  RuntimeRawModule,
  RuntimeScopeModule,
  SpeechListVoicesInput,
  SpeechListVoicesOutput,
  SpeechStreamSynthesisInput,
  SpeechSynthesizeInput,
  SpeechSynthesizeOutput,
  SpeechTranscribeInput,
  SpeechTranscribeOutput,
  TextGenerateInput,
  TextGenerateOutput,
  TextMessage,
  TextStreamInput,
  TextStreamOutput,
  VideoGenerateInput,
  VideoGenerateOutput,
} from './types.js';

type RuntimeMethodLookupEntry = {
  moduleKey: keyof typeof RuntimeMethodIds;
  methodKey: string;
  stream: boolean;
};

const DEFAULT_WAIT_FOR_READY_TIMEOUT_MS = 10000;
const DEFAULT_MEDIA_POLL_INTERVAL_MS = 250;
const DEFAULT_MEDIA_TIMEOUT_MS = 120000;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BACKOFF_MS = 200;
const MAX_RETRY_BACKOFF_MS = 3000;

const RETRYABLE_RUNTIME_REASON_CODES: ReadonlySet<string> = new Set([
  ReasonCode.RUNTIME_UNAVAILABLE,
  ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE,
  ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED,
  ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_UNARY_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_STREAM_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_INVOKE_MISSING,
  ReasonCode.SDK_RUNTIME_TAURI_LISTEN_MISSING,
]);

const RUNTIME_METHOD_LOOKUP: Readonly<Record<string, RuntimeMethodLookupEntry>> = buildRuntimeMethodLookup();

function buildRuntimeMethodLookup(): Readonly<Record<string, RuntimeMethodLookupEntry>> {
  const lookup: Record<string, RuntimeMethodLookupEntry> = {};
  const groups = Object.entries(RuntimeMethodIds) as Array<
    [keyof typeof RuntimeMethodIds, Record<string, string>]
  >;

  for (const [moduleKey, methods] of groups) {
    for (const [methodKey, methodId] of Object.entries(methods)) {
      lookup[methodId] = {
        moduleKey,
        methodKey,
        stream: isRuntimeStreamMethod(methodId),
      };
    }
  }

  return Object.freeze(lookup);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

function toRoutePolicy(value: NimiRoutePolicy | undefined): RoutePolicy {
  return value === 'token-api' ? RoutePolicy.TOKEN_API : RoutePolicy.LOCAL_RUNTIME;
}

function fromRoutePolicy(value: RoutePolicy): NimiRoutePolicy {
  return value === RoutePolicy.TOKEN_API ? 'token-api' : 'local-runtime';
}

function toFallbackPolicy(value: NimiFallbackPolicy | undefined): FallbackPolicy {
  return value === 'allow' ? FallbackPolicy.ALLOW : FallbackPolicy.DENY;
}

function toFinishReason(value: FinishReason): NimiFinishReason {
  switch (value) {
    case FinishReason.LENGTH:
      return 'length';
    case FinishReason.CONTENT_FILTER:
      return 'content-filter';
    case FinishReason.TOOL_CALL:
      return 'tool-calls';
    case FinishReason.ERROR:
      return 'error';
    case FinishReason.STOP:
    default:
      return 'stop';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return undefined;
}

function toUsage(value: unknown): NimiTokenUsage {
  const usage = asRecord(value);
  const inputTokens = parseCount(usage.inputTokens);
  const outputTokens = parseCount(usage.outputTokens);
  const totalTokens = typeof inputTokens === 'number' && typeof outputTokens === 'number'
    ? inputTokens + outputTokens
    : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function toTraceInfo(input: {
  traceId?: unknown;
  modelResolved?: unknown;
  routeDecision?: unknown;
}): NimiTraceInfo {
  return {
    traceId: normalizeText(input.traceId) || undefined,
    modelResolved: normalizeText(input.modelResolved) || undefined,
    routeDecision: Number(input.routeDecision) === RoutePolicy.TOKEN_API ? 'token-api' : 'local-runtime',
  };
}

function extractGenerateText(output: GenerateResponse['output']): string {
  const fields = asRecord(asRecord(output).fields);
  const text = asRecord(fields.text);
  const kind = asRecord(text.kind);

  if (kind.oneofKind === 'stringValue') {
    return normalizeText(kind.stringValue);
  }
  if (typeof text.stringValue === 'string') {
    return normalizeText(text.stringValue);
  }
  return '';
}

function toRuntimeMessages(input: string | TextMessage[], system?: string): {
  systemPrompt: string;
  input: Array<{ role: string; content: string; name: string }>;
} {
  if (typeof input === 'string') {
    const content = normalizeText(input);
    if (!content) {
      throw createNimiError({
        message: 'text input is required',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_text_input',
        source: 'sdk',
      });
    }
    return {
      systemPrompt: normalizeText(system),
      input: [{ role: 'user', content, name: '' }],
    };
  }

  const systemParts: string[] = [];
  const messages: Array<{ role: string; content: string; name: string }> = [];

  if (Array.isArray(input)) {
    for (const message of input) {
      const content = normalizeText(message.content);
      if (!content) {
        continue;
      }
      if (message.role === 'system') {
        systemParts.push(content);
        continue;
      }
      messages.push({
        role: message.role,
        content,
        name: normalizeText(message.name),
      });
    }
  }

  const explicitSystem = normalizeText(system);
  if (explicitSystem) {
    systemParts.push(explicitSystem);
  }

  if (messages.length === 0) {
    throw createNimiError({
      message: 'text input must include at least one non-system message',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'add_user_or_assistant_message',
      source: 'sdk',
    });
  }

  return {
    systemPrompt: systemParts.join('\n\n'),
    input: messages,
  };
}

function toEmbeddingVectors(vectors: unknown): number[][] {
  const items = Array.isArray(vectors) ? vectors : [];
  return items.map((entry) => {
    const values = Array.isArray(asRecord(entry).values)
      ? asRecord(entry).values as unknown[]
      : [];
    return values
      .map((value) => {
        const kind = asRecord(asRecord(value).kind);
        if (kind.oneofKind === 'numberValue') {
          const parsed = Number(kind.numberValue);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      })
      .filter((value): value is number => value !== null);
  });
}

function toProtoStruct(input: Record<string, unknown> | undefined): Struct | undefined {
  if (!input || Object.keys(input).length === 0) {
    return undefined;
  }
  try {
    return Struct.fromJson(input as never);
  } catch {
    return undefined;
  }
}

function toLabels(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    labels[normalizedKey] = normalizedValue;
  }
  return labels;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toIsoFromTimestamp(value: unknown): string | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const secondsRaw = record.seconds;
  const nanosRaw = record.nanos;
  const seconds = Number(secondsRaw);
  const nanos = Number(nanosRaw);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  const millis = (seconds * 1000) + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function mediaStatusToString(status: MediaJobStatus): string {
  switch (status) {
    case MediaJobStatus.SUBMITTED:
      return 'SUBMITTED';
    case MediaJobStatus.QUEUED:
      return 'QUEUED';
    case MediaJobStatus.RUNNING:
      return 'RUNNING';
    case MediaJobStatus.COMPLETED:
      return 'COMPLETED';
    case MediaJobStatus.FAILED:
      return 'FAILED';
    case MediaJobStatus.CANCELED:
      return 'CANCELED';
    case MediaJobStatus.TIMEOUT:
      return 'TIMEOUT';
    default:
      return 'UNSPECIFIED';
  }
}

function resolveHealthStatus(status: RuntimeHealthStatus): RuntimeHealth['status'] {
  if (status === RuntimeHealthStatus.READY) {
    return 'healthy';
  }
  if (status === RuntimeHealthStatus.DEGRADED) {
    return 'degraded';
  }
  return 'unavailable';
}

export class Runtime {
  readonly appId: string;

  readonly auth: RuntimeAuthClient;

  readonly appAuth: RuntimeAppAuthClient;

  readonly ai: RuntimeAiModule;

  readonly media: RuntimeMediaModule;

  readonly workflow: RuntimeWorkflowClient;

  readonly model: RuntimeModelClient;

  readonly localRuntime: RuntimeLocalRuntimeClient;

  readonly connector: RuntimeConnectorClient;

  readonly knowledge: RuntimeKnowledgeClient;

  readonly app: {
    sendMessage: RuntimeClient['app']['sendAppMessage'];
    subscribeMessages: RuntimeClient['app']['subscribeAppMessages'];
  };

  readonly audit: RuntimeAuditClient;

  readonly scope: RuntimeScopeModule;

  readonly events: RuntimeEventsModule;

  readonly raw: RuntimeRawModule;

  readonly transport: RuntimeTransportConfig;

  #client: RuntimeClient | null = null;

  #connectPromise: Promise<void> | null = null;

  #state: RuntimeConnectionState = {
    status: 'idle',
  };

  readonly #options: RuntimeOptions;

  readonly #scopeModule: ScopeModule;

  readonly #eventBus = createEventBus<RuntimeEventPayloadMap>();

  constructor(options: RuntimeOptions) {
    const normalizedAppId = normalizeText(options.appId);
    if (!normalizedAppId) {
      throw createNimiError({
        message: 'appId is required',
        reasonCode: ReasonCode.SDK_APP_ID_REQUIRED,
        actionHint: 'set_app_id',
        source: 'sdk',
      });
    }
    this.appId = normalizedAppId;
    if (!options.transport) {
      throw createNimiError({
        message: 'transport is required (node-grpc or tauri-ipc)',
        reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
        actionHint: 'set_transport',
        source: 'sdk',
      });
    }
    this.transport = options.transport;
    this.#options = {
      ...options,
      appId: this.appId,
      connection: {
        mode: options.connection?.mode || 'auto',
        waitForReadyTimeoutMs: options.connection?.waitForReadyTimeoutMs,
      },
    };

    this.#scopeModule = createScopeModule({ appId: this.appId });

    this.events = {
      on: (name, handler) => this.#eventBus.on(name, handler),
      once: (name, handler) => this.#eventBus.once(name, handler),
    };

    this.auth = this.#createPassthroughModule('auth') as RuntimeAuthClient;
    this.workflow = this.#createPassthroughModule('workflow') as RuntimeWorkflowClient;
    this.model = this.#createPassthroughModule('model') as RuntimeModelClient;
    this.localRuntime = this.#createPassthroughModule('localRuntime') as RuntimeLocalRuntimeClient;
    this.connector = this.#createPassthroughModule('connector') as RuntimeConnectorClient;
    this.knowledge = this.#createPassthroughModule('knowledge') as RuntimeKnowledgeClient;
    this.audit = this.#createPassthroughModule('audit') as RuntimeAuditClient;

    this.app = {
      sendMessage: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.app.sendAppMessage(request, optionsValue),
      ),
      subscribeMessages: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.app.subscribeAppMessages(request, optionsValue),
      ),
    };

    this.appAuth = {
      authorizeExternalPrincipal: async (request, optionsValue) => {
        const resolvedScopeCatalogVersion = this.#scopeModule.resolvePublishedCatalogVersion(
          request.scopeCatalogVersion,
        );

        const response = await this.#invokeWithClient(async (client) => client.appAuth.authorizeExternalPrincipal(
          {
            ...request,
            scopeCatalogVersion: resolvedScopeCatalogVersion,
          },
          optionsValue,
        ));

        const issuedScopeCatalogVersion = normalizeText(
          (response as unknown as Record<string, unknown>).issuedScopeCatalogVersion,
        );
        if (issuedScopeCatalogVersion && issuedScopeCatalogVersion !== resolvedScopeCatalogVersion) {
          this.#emitTelemetry('runtime.app-auth.scope-version-mismatch', {
            requested: resolvedScopeCatalogVersion,
            issued: issuedScopeCatalogVersion,
          });
        }

        const tokenId = normalizeText((response as unknown as Record<string, unknown>).tokenId);
        if (tokenId) {
          this.#eventBus.emit('auth.token.issued', { tokenId, at: nowIso() });
        }

        return response;
      },
      validateToken: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.appAuth.validateToken(request, optionsValue),
      ),
      revokeToken: async (request, optionsValue) => {
        const response = await this.#invokeWithClient(
          async (client) => client.appAuth.revokeToken(request, optionsValue),
        );
        const tokenId = normalizeText((request as unknown as Record<string, unknown>).tokenId);
        if (tokenId) {
          this.#eventBus.emit('auth.token.revoked', { tokenId, at: nowIso() });
        }
        return response;
      },
      issueDelegatedToken: async (request, optionsValue) => {
        const response = await this.#invokeWithClient(
          async (client) => client.appAuth.issueDelegatedToken(request, optionsValue),
        );
        const tokenId = normalizeText((response as unknown as Record<string, unknown>).tokenId);
        if (tokenId) {
          this.#eventBus.emit('auth.token.issued', { tokenId, at: nowIso() });
        }
        return response;
      },
      listTokenChain: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.appAuth.listTokenChain(request, optionsValue),
      ),
    };

    this.scope = {
      register: async (input) => this.#invoke(async () => this.#scopeModule.registerAppScopes({ manifest: input })),
      publish: async () => this.#invoke(async () => this.#scopeModule.publishCatalog()),
      revoke: async (input) => this.#invoke(async () => this.#scopeModule.revokeAppScopes({ scopes: input.scopes })),
      list: async (input) => this.#invoke(async () => this.#scopeModule.listCatalog(input)),
    };

    this.ai = {
      generate: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.generate(request, optionsValue),
      ),
      streamGenerate: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.streamGenerate(request, optionsValue),
      ),
      embed: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.embed(request, optionsValue),
      ),
      submitMediaJob: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.submitMediaJob(request, optionsValue),
      ),
      getMediaJob: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.getMediaJob(request, optionsValue),
      ),
      cancelMediaJob: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.cancelMediaJob(request, optionsValue),
      ),
      subscribeMediaJobEvents: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.subscribeMediaJobEvents(request, optionsValue),
      ),
      getMediaResult: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.getMediaResult(request, optionsValue),
      ),
      text: {
        generate: async (input) => this.#generateText(input),
        stream: async (input) => this.#streamText(input),
      },
      embedding: {
        generate: async (input) => this.#generateEmbedding(input),
      },
    };

    this.media = {
      image: {
        generate: async (input) => this.#generateImage(input),
        stream: async (input) => this.#streamImage(input),
      },
      video: {
        generate: async (input) => this.#generateVideo(input),
        stream: async (input) => this.#streamVideo(input),
      },
      tts: {
        synthesize: async (input) => this.#synthesizeSpeech(input),
        stream: async (input) => this.#streamSpeech(input),
        listVoices: async (input) => this.#listSpeechVoices(input),
        streamSynthesis: (input) => this.#streamSpeechSynthesis(input),
      },
      stt: {
        transcribe: async (input) => this.#transcribeSpeech(input),
      },
      jobs: {
        submit: async (input) => this.#submitMediaJob(input),
        get: async (jobId) => this.#getMediaJob(jobId),
        cancel: async (input) => this.#cancelMediaJob(input),
        subscribe: async (jobId) => this.#subscribeMediaJob(jobId),
        getArtifacts: async (jobId) => this.#getMediaArtifacts(jobId),
      },
    };

    this.raw = {
      call: async (methodId, input, optionsValue) => this.#rawCall(methodId, input, optionsValue),
      closeStream: async (streamId) => this.#invokeWithClient(
        async (client) => client.closeStream(streamId),
      ),
    };
  }

  async connect(): Promise<void> {
    if (this.#state.status === 'ready') {
      return;
    }
    if (this.#connectPromise) {
      return this.#connectPromise;
    }

    this.#state = {
      ...this.#state,
      status: 'connecting',
    };

    const connectedAt = nowIso();
    const connectPromise = (async () => {
      this.#client = createRuntimeClient({
        appId: this.appId,
        transport: this.#options.transport,
        defaults: this.#options.defaults,
      });
      this.#state = {
        ...this.#state,
        status: 'ready',
        connectedAt,
      };
      this.#eventBus.emit('runtime.connected', { at: connectedAt });
      this.#emitTelemetry('runtime.connected', { at: connectedAt });
    })();

    this.#connectPromise = connectPromise;

    try {
      await connectPromise;
    } catch (error) {
      this.#state = {
        ...this.#state,
        status: 'idle',
      };
      throw error;
    } finally {
      this.#connectPromise = null;
    }
  }

  async ready(input?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = this.#resolveReadyTimeout(input?.timeoutMs);

    await this.#waitForReady(timeoutMs);

    const health = await this.#withTimeout(this.health(), timeoutMs, {
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_and_retry',
      source: 'runtime',
    });

    if (health.status === 'unavailable') {
      throw createNimiError({
        message: `runtime is unavailable: ${normalizeText(health.reason) || 'unknown reason'}`,
        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
        actionHint: 'check_runtime_daemon_and_retry',
        source: 'runtime',
      });
    }

    this.#state = {
      ...this.#state,
      status: 'ready',
      lastReadyAt: nowIso(),
    };
  }

  async close(input?: { force?: boolean }): Promise<void> {
    void input;

    if (this.#state.status === 'closed') {
      return;
    }

    this.#state = {
      ...this.#state,
      status: 'closing',
    };

    this.#client = null;

    const at = nowIso();
    this.#state = {
      ...this.#state,
      status: 'closed',
    };
    this.#eventBus.emit('runtime.disconnected', { at });
    this.#emitTelemetry('runtime.disconnected', { at });
  }

  state(): RuntimeConnectionState {
    return { ...this.#state };
  }

  async health(): Promise<RuntimeHealth> {
    const response = await this.#invokeWithClient(async (client) => client.audit.getRuntimeHealth({}));

    return {
      status: resolveHealthStatus(response.status),
      reason: normalizeText(response.reason) || undefined,
      queueDepth: response.queueDepth,
      activeWorkflows: response.activeWorkflows,
      activeInferenceJobs: response.activeInferenceJobs,
      cpuMilli: normalizeText(response.cpuMilli) || undefined,
      memoryBytes: normalizeText(response.memoryBytes) || undefined,
      vramBytes: normalizeText(response.vramBytes) || undefined,
      sampledAt: toIsoFromTimestamp(response.sampledAt),
    };
  }

  call<TReq, TRes>(
    method: RuntimeMethod<TReq, TRes> | string,
    input: TReq,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<TRes> {
    const methodId = typeof method === 'string' ? method : method.methodId;
    return this.raw.call<TReq, TRes>(methodId, input, options);
  }

  #resolveReadyTimeout(timeoutMs?: number): number {
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      return timeoutMs;
    }
    const configured = this.#options.connection?.waitForReadyTimeoutMs;
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return DEFAULT_WAIT_FOR_READY_TIMEOUT_MS;
  }

  async #waitForReady(timeoutMs: number): Promise<void> {
    if (this.#state.status === 'ready') {
      return;
    }

    const mode = this.#options.connection?.mode || 'auto';
    if (mode === 'manual') {
      throw createNimiError({
        message: 'runtime manual mode requires explicit connect() before calling APIs',
        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
        actionHint: 'call_runtime_connect_first',
        source: 'sdk',
      });
    }

    if (!this.#connectPromise) {
      await this.connect();
      return;
    }

    await this.#withTimeout(this.#connectPromise, timeoutMs, {
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'retry_or_check_runtime_daemon',
      source: 'runtime',
    });
  }

  async #ensureClientForCall(): Promise<RuntimeClient> {
    const timeoutMs = this.#resolveReadyTimeout(undefined);
    const mode = this.#options.connection?.mode || 'auto';

    if (mode === 'manual') {
      if (this.#state.status !== 'ready' || !this.#client) {
        throw createNimiError({
          message: 'runtime is not connected (manual mode)',
          reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
          actionHint: 'call_runtime_connect_first',
          source: 'sdk',
        });
      }
      return this.#client;
    }

    if (!this.#client || this.#state.status !== 'ready') {
      await this.#waitForReady(timeoutMs);
    }

    if (!this.#client) {
      throw createNimiError({
        message: 'runtime client is unavailable',
        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
        actionHint: 'retry_or_check_runtime_daemon',
        source: 'runtime',
      });
    }

    return this.#client;
  }

  #createPassthroughModule<Module extends Record<string, (...args: unknown[]) => Promise<unknown>>>(
    moduleKey: keyof Pick<RuntimeClient, 'auth' | 'workflow' | 'model' | 'localRuntime' | 'connector' | 'knowledge' | 'audit'>,
  ): Module {
    return new Proxy({} as Module, {
      get: (_target, property: string | symbol) => {
        if (typeof property !== 'string') {
          return undefined;
        }

        return async (...args: unknown[]) => this.#invokeWithClient(async (client) => {
          const module = (client as unknown as Record<string, unknown>)[moduleKey] as Record<string, unknown>;
          const method = module[property];
          if (typeof method !== 'function') {
            throw createNimiError({
              message: `${String(moduleKey)}.${property} is not implemented`,
              reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
              actionHint: 'check_runtime_method_mapping',
              source: 'sdk',
            });
          }
          return await (method as (...innerArgs: unknown[]) => Promise<unknown>)(...args);
        });
      },
    });
  }

  async #invokeWithClient<T>(operation: (client: RuntimeClient) => Promise<T>): Promise<T> {
    return this.#invoke(async () => {
      const client = await this.#ensureClientForCall();
      return operation(client);
    });
  }

  async #invoke<T>(operation: () => Promise<T>): Promise<T> {
    const retry = this.#resolveRetryConfig();

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      try {
        const value = await operation();
        if (attempt > 1 && this.#state.status !== 'ready') {
          const at = nowIso();
          this.#state = {
            ...this.#state,
            status: 'ready',
            lastReadyAt: at,
          };
          this.#eventBus.emit('runtime.connected', { at });
          this.#emitTelemetry('runtime.connected', {
            at,
            reason: 'auto_retry_recovered',
            attempt,
          });
        }
        return value;
      } catch (error) {
        const normalized = asNimiError(error, {
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'retry_or_check_runtime_status',
          source: 'runtime',
        });

        if (this.#shouldRetryRuntimeCall(normalized, attempt, retry.maxAttempts)) {
          const at = nowIso();
          this.#client = null;
          this.#state = {
            ...this.#state,
            status: 'idle',
          };
          this.#eventBus.emit('runtime.disconnected', {
            at,
            reasonCode: normalized.reasonCode,
          });
          this.#emitTelemetry('runtime.disconnected', {
            at,
            reasonCode: normalized.reasonCode,
            attempt,
          });

          const backoffMs = this.#computeRetryBackoffMs(retry.backoffMs, attempt);
          this.#emitTelemetry('runtime.retry', {
            attempt,
            maxAttempts: retry.maxAttempts,
            backoffMs,
            reasonCode: normalized.reasonCode,
          });
          await sleep(backoffMs);
          continue;
        }

        this.#eventBus.emit('error', {
          error: normalized,
          at: nowIso(),
        });
        this.#emitTelemetry('runtime.error', {
          reasonCode: normalized.reasonCode,
          actionHint: normalized.actionHint,
          traceId: normalized.traceId,
        });
        throw normalized;
      }
    }

    throw createNimiError({
      message: 'runtime invoke exhausted retry attempts',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_and_retry',
      source: 'runtime',
    });
  }

  #resolveRetryConfig(): { maxAttempts: number; backoffMs: number } {
    const maxAttemptsRaw = this.#options.retry?.maxAttempts;
    const backoffMsRaw = this.#options.retry?.backoffMs;

    const maxAttempts = Number.isFinite(maxAttemptsRaw) && Number(maxAttemptsRaw) > 0
      ? Math.max(1, Math.floor(Number(maxAttemptsRaw)))
      : DEFAULT_RETRY_MAX_ATTEMPTS;
    const backoffMs = Number.isFinite(backoffMsRaw) && Number(backoffMsRaw) > 0
      ? Math.floor(Number(backoffMsRaw))
      : DEFAULT_RETRY_BACKOFF_MS;

    return {
      maxAttempts,
      backoffMs,
    };
  }

  #computeRetryBackoffMs(baseBackoffMs: number, attempt: number): number {
    const exponent = Math.max(0, attempt - 1);
    const exponential = baseBackoffMs * (2 ** exponent);
    const jitter = Math.floor(Math.random() * (baseBackoffMs / 2));
    return Math.min(exponential + jitter, MAX_RETRY_BACKOFF_MS);
  }

  #shouldRetryRuntimeCall(error: NimiError, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) {
      return false;
    }

    if ((this.#options.connection?.mode || 'auto') !== 'auto') {
      return false;
    }

    if (error.reasonCode === ReasonCode.OPERATION_ABORTED) {
      return false;
    }

    if (error.retryable) {
      return true;
    }

    return RETRYABLE_RUNTIME_REASON_CODES.has(error.reasonCode);
  }

  #emitTelemetry(name: string, data?: Record<string, unknown>): void {
    if (!this.#options.telemetry?.enabled || typeof this.#options.telemetry.onEvent !== 'function') {
      return;
    }
    this.#options.telemetry.onEvent({
      name,
      at: nowIso(),
      data,
    });
  }

  async #withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    fallback: {
      reasonCode: string;
      actionHint: string;
      source: 'sdk' | 'runtime' | 'realm';
    },
  ): Promise<T> {
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
      return promise;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(createNimiError({
              message: `operation timed out after ${timeoutMs}ms`,
              reasonCode: fallback.reasonCode,
              actionHint: fallback.actionHint,
              source: fallback.source,
            }));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  #resolveRuntimeCallOptions(input: {
    timeoutMs?: number;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }): RuntimeCallOptions {
    const timeoutMs = typeof input.timeoutMs === 'number'
      ? input.timeoutMs
      : this.#options.timeoutMs;

    const metadataInput = input.metadata || {};
    const keySource = normalizeText(
      metadataInput['x-nimi-key-source'] || metadataInput.keySource,
    ).toLowerCase() || 'managed';
    const providerType = normalizeText(
      metadataInput['x-nimi-provider-type'] || metadataInput.providerType,
    ) || undefined;
    const providerEndpoint = normalizeText(
      metadataInput['x-nimi-provider-endpoint'] || metadataInput.providerEndpoint,
    ) || undefined;
    const providerApiKey = normalizeText(
      metadataInput['x-nimi-provider-api-key'] || metadataInput.providerApiKey,
    ) || undefined;

    const metadataExtraEntries = Object.entries(metadataInput)
      .filter(([key]) => {
        const normalizedKey = normalizeText(key).toLowerCase();
        return normalizedKey !== 'x-nimi-key-source'
          && normalizedKey !== 'keysource'
          && normalizedKey !== 'x-nimi-provider-type'
          && normalizedKey !== 'providertype'
          && normalizedKey !== 'x-nimi-provider-endpoint'
          && normalizedKey !== 'providerendpoint'
          && normalizedKey !== 'x-nimi-provider-api-key'
          && normalizedKey !== 'providerapikey';
      });
    const metadataExtra = metadataExtraEntries.length > 0
      ? Object.fromEntries(metadataExtraEntries)
      : undefined;

    const metadata = {
      keySource: keySource as 'inline' | 'managed',
      providerType,
      providerEndpoint,
      providerApiKey,
      extra: metadataExtra,
    };

    return {
      timeoutMs,
      metadata,
      idempotencyKey: normalizeText(input.idempotencyKey) || undefined,
    };
  }

  #resolveRuntimeStreamOptions(input: {
    timeoutMs?: number;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): RuntimeStreamCallOptions {
    return {
      ...this.#resolveRuntimeCallOptions(input),
      signal: input.signal,
    };
  }

  async #resolveSubjectUserId(explicit?: string): Promise<string> {
    const direct = normalizeText(explicit);
    if (direct) {
      return direct;
    }

    const configured = normalizeText(this.#options.authContext?.subjectUserId);
    if (configured) {
      return configured;
    }

    const resolver = this.#options.authContext?.getSubjectUserId;
    if (typeof resolver === 'function') {
      const resolved = normalizeText(await resolver());
      if (resolved) {
        return resolved;
      }
    }

    throw createNimiError({
      message: 'subjectUserId is required (set authContext or pass per call)',
      reasonCode: ReasonCode.AUTH_CONTEXT_MISSING,
      actionHint: 'set_runtime_auth_context_subject_user',
      source: 'sdk',
    });
  }

  async #generateText(input: TextGenerateInput): Promise<TextGenerateOutput> {
    const subjectUserId = await this.#resolveSubjectUserId(input.subjectUserId);
    const prompt = toRuntimeMessages(input.input, input.system);
    const request: GenerateRequest = {
      appId: this.appId,
      subjectUserId,
      modelId: ensureText(input.model, 'model'),
      modal: Modal.TEXT,
      input: prompt.input,
      systemPrompt: prompt.systemPrompt,
      tools: [],
      temperature: Number(input.temperature || 0),
      topP: Number(input.topP || 0),
      maxTokens: Number(input.maxTokens || 0),
      routePolicy: toRoutePolicy(input.route),
      fallback: toFallbackPolicy(input.fallback),
      timeoutMs: Number(input.timeoutMs || this.#options.timeoutMs || 0),
      connectorId: '',
    };

    const response = await this.#invokeWithClient(async (client) => client.ai.generate(
      request,
      this.#resolveRuntimeCallOptions({
        timeoutMs: input.timeoutMs,
        metadata: input.metadata,
      }),
    ));

    const trace = toTraceInfo({
      traceId: response.traceId,
      modelResolved: response.modelResolved,
      routeDecision: response.routeDecision,
    });

    this.#eventBus.emit('ai.route.decision', {
      route: trace.routeDecision || 'local-runtime',
      model: request.modelId,
      traceId: trace.traceId,
    });

    return {
      text: extractGenerateText(response.output),
      finishReason: toFinishReason(response.finishReason),
      usage: toUsage(response.usage),
      trace,
    };
  }

  async #streamText(input: TextStreamInput): Promise<TextStreamOutput> {
    const subjectUserId = await this.#resolveSubjectUserId(input.subjectUserId);
    const prompt = toRuntimeMessages(input.input, input.system);

    const stream = await this.#invokeWithClient(async (client) => client.ai.streamGenerate(
      {
        appId: this.appId,
        subjectUserId,
        modelId: ensureText(input.model, 'model'),
        modal: Modal.TEXT,
        input: prompt.input,
        systemPrompt: prompt.systemPrompt,
        tools: [],
        temperature: Number(input.temperature || 0),
        topP: Number(input.topP || 0),
        maxTokens: Number(input.maxTokens || 0),
        routePolicy: toRoutePolicy(input.route),
        fallback: toFallbackPolicy(input.fallback),
        timeoutMs: Number(input.timeoutMs || this.#options.timeoutMs || 0),
        connectorId: '',
      },
      this.#resolveRuntimeStreamOptions({
        timeoutMs: input.timeoutMs,
        metadata: input.metadata,
        signal: input.signal,
      }),
    ));

    const owner = this;
    const wrapped: AsyncIterable<TextStreamOutput['stream'] extends AsyncIterable<infer Part> ? Part : never> = {
      async *[Symbol.asyncIterator]() {
        let streamModelResolved = '';
        let streamRouteDecision: RoutePolicy = RoutePolicy.LOCAL_RUNTIME;
        let streamUsage: unknown = undefined;

        yield { type: 'start' as const };
        for await (const event of stream) {
          const payloadKind = normalizeText(asRecord(event.payload).oneofKind);

          if (payloadKind === 'started') {
            const started = asRecord(asRecord(event.payload).started);
            streamModelResolved = normalizeText(started.modelResolved);
            const routeDecision = Number(started.routeDecision);
            streamRouteDecision = routeDecision === RoutePolicy.TOKEN_API
              ? RoutePolicy.TOKEN_API
              : RoutePolicy.LOCAL_RUNTIME;
            owner.#eventBus.emit('ai.route.decision', {
              route: fromRoutePolicy(streamRouteDecision),
              model: streamModelResolved || ensureText(input.model, 'model'),
              traceId: normalizeText(event.traceId) || undefined,
            });
            continue;
          }

          if (payloadKind === 'delta') {
            const delta = normalizeText(asRecord(asRecord(event.payload).delta).text);
            if (delta) {
              yield { type: 'delta' as const, text: delta };
            }
            continue;
          }

          if (payloadKind === 'usage') {
            streamUsage = asRecord(asRecord(event.payload).usage);
            continue;
          }

          if (payloadKind === 'completed') {
            const trace = toTraceInfo({
              traceId: event.traceId,
              modelResolved: streamModelResolved,
              routeDecision: streamRouteDecision,
            });
            yield {
              type: 'finish' as const,
              finishReason: toFinishReason(asRecord(asRecord(event.payload).completed).finishReason as FinishReason),
              usage: toUsage(streamUsage),
              trace,
            };
            continue;
          }

          if (payloadKind === 'failed') {
            const failed = asRecord(asRecord(event.payload).failed);
            yield {
              type: 'error' as const,
              error: createNimiError({
                message: normalizeText(failed.actionHint) || 'runtime stream failed',
                reasonCode: normalizeText(failed.reasonCode) || ReasonCode.AI_STREAM_BROKEN,
                actionHint: 'retry_or_switch_route',
                source: 'runtime',
              }),
            };
          }
        }
      },
    };

    return {
      stream: wrapped,
    };
  }

  async #generateEmbedding(input: EmbeddingGenerateInput): Promise<EmbeddingGenerateOutput> {
    const subjectUserId = await this.#resolveSubjectUserId(input.subjectUserId);
    const values = Array.isArray(input.input)
      ? input.input.map((value) => normalizeText(value)).filter((value) => value.length > 0)
      : [normalizeText(input.input)].filter((value) => value.length > 0);

    if (values.length === 0) {
      throw createNimiError({
        message: 'embedding input is required',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_embedding_input',
        source: 'sdk',
      });
    }

    const response = await this.#invokeWithClient(async (client) => client.ai.embed(
      {
        appId: this.appId,
        subjectUserId,
        modelId: ensureText(input.model, 'model'),
        inputs: values,
        routePolicy: toRoutePolicy(input.route),
        fallback: toFallbackPolicy(input.fallback),
        timeoutMs: Number(input.timeoutMs || this.#options.timeoutMs || 0),
        connectorId: '',
      },
      this.#resolveRuntimeCallOptions({
        timeoutMs: input.timeoutMs,
        metadata: input.metadata,
      }),
    ));

    const trace = toTraceInfo({
      traceId: response.traceId,
      modelResolved: response.modelResolved,
      routeDecision: response.routeDecision,
    });

    this.#eventBus.emit('ai.route.decision', {
      route: trace.routeDecision || 'local-runtime',
      model: ensureText(input.model, 'model'),
      traceId: trace.traceId,
    });

    return {
      vectors: toEmbeddingVectors(response.vectors),
      usage: toUsage(response.usage),
      trace,
    };
  }

  async #rawCall<TReq, TRes>(
    methodId: string,
    input: TReq,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<TRes> {
    const binding = RUNTIME_METHOD_LOOKUP[methodId];
    if (!binding) {
      throw createNimiError({
        message: `runtime method is not allowlisted: ${methodId}`,
        reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
        actionHint: 'use_runtime_method_ids',
        source: 'sdk',
      });
    }

    return this.#invokeWithClient(async (client) => {
      const module = (client as unknown as Record<string, unknown>)[binding.moduleKey] as Record<string, unknown>;
      const method = module[binding.methodKey];
      if (typeof method !== 'function') {
        throw createNimiError({
          message: `${binding.moduleKey}.${binding.methodKey} is not implemented`,
          reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
          actionHint: 'check_runtime_method_mapping',
          source: 'sdk',
        });
      }

      if (binding.stream) {
        return await (method as (
          request: TReq,
          callOptions?: RuntimeStreamCallOptions,
        ) => Promise<TRes>)(input, options as RuntimeStreamCallOptions | undefined);
      }

      return await (method as (
        request: TReq,
        callOptions?: RuntimeCallOptions,
      ) => Promise<TRes>)(input, options as RuntimeCallOptions | undefined);
    });
  }

  async #submitMediaJob(input: MediaJobSubmitInput): Promise<MediaJob> {
    const request = await this.#buildSubmitMediaJobRequest(input);
    const metadata = input.input.metadata;

    const response = await this.#invokeWithClient(async (client) => client.ai.submitMediaJob(
      request,
      this.#resolveRuntimeCallOptions({
        timeoutMs: request.timeoutMs,
        idempotencyKey: request.idempotencyKey,
        metadata,
      }),
    ));

    if (!response.job) {
      throw createNimiError({
        message: 'submitMediaJob returned empty job',
        reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
        actionHint: 'retry_media_job_request',
        source: 'runtime',
      });
    }

    this.#eventBus.emit('media.job.status', {
      jobId: response.job.jobId,
      status: mediaStatusToString(response.job.status),
      at: nowIso(),
    });

    return response.job;
  }

  async #getMediaJob(jobId: string): Promise<MediaJob> {
    const response = await this.#invokeWithClient(async (client) => client.ai.getMediaJob({
      jobId: ensureText(jobId, 'jobId'),
    }));

    if (!response.job) {
      throw createNimiError({
        message: `media job not found: ${jobId}`,
        reasonCode: ReasonCode.AI_MODEL_NOT_FOUND,
        actionHint: 'check_job_id_or_retry_submit',
        source: 'runtime',
      });
    }

    return response.job;
  }

  async #cancelMediaJob(input: { jobId: string; reason?: string }): Promise<MediaJob> {
    const request: CancelMediaJobRequest = {
      jobId: ensureText(input.jobId, 'jobId'),
      reason: normalizeText(input.reason),
    };

    const response = await this.#invokeWithClient(async (client) => client.ai.cancelMediaJob(request));
    if (!response.job) {
      throw createNimiError({
        message: `cancelMediaJob returned empty job: ${request.jobId}`,
        reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
        actionHint: 'retry_or_check_job_status',
        source: 'runtime',
      });
    }

    this.#eventBus.emit('media.job.status', {
      jobId: response.job.jobId,
      status: mediaStatusToString(response.job.status),
      at: nowIso(),
    });

    return response.job;
  }

  async #subscribeMediaJob(jobId: string): Promise<AsyncIterable<import('./generated/runtime/v1/ai').MediaJobEvent>> {
    return this.#invokeWithClient(async (client) => client.ai.subscribeMediaJobEvents({
      jobId: ensureText(jobId, 'jobId'),
    }));
  }

  async #getMediaArtifacts(jobId: string): Promise<{ artifacts: import('./generated/runtime/v1/ai').MediaArtifact[]; traceId?: string }> {
    const response = await this.#invokeWithClient(async (client) => client.ai.getMediaResult({
      jobId: ensureText(jobId, 'jobId'),
    }));

    return {
      artifacts: response.artifacts,
      traceId: normalizeText(response.traceId) || undefined,
    };
  }

  async #buildSubmitMediaJobRequest(input: MediaJobSubmitInput): Promise<SubmitMediaJobRequest> {
    const timeoutMs = Number(
      (input.input as { timeoutMs?: unknown }).timeoutMs || this.#options.timeoutMs || 0,
    );
    const route = toRoutePolicy((input.input as { route?: NimiRoutePolicy }).route);
    const fallback = toFallbackPolicy((input.input as { fallback?: NimiFallbackPolicy }).fallback);

    const subjectUserId = await this.#resolveSubjectUserId(
      (input.input as { subjectUserId?: string }).subjectUserId,
    );

    const base: SubmitMediaJobRequest = {
      appId: this.appId,
      subjectUserId,
      modelId: ensureText((input.input as { model: string }).model, 'model'),
      modal: Modal.UNSPECIFIED,
      routePolicy: route,
      fallback,
      timeoutMs,
      requestId: normalizeText((input.input as { requestId?: string }).requestId),
      idempotencyKey: normalizeText((input.input as { idempotencyKey?: string }).idempotencyKey),
      labels: toLabels((input.input as { labels?: Record<string, string> }).labels),
      spec: { oneofKind: undefined },
      connectorId: '',
    };

    if (input.modal === 'image') {
      const value = input.input as ImageGenerateInput;
      return {
        ...base,
        modal: Modal.IMAGE,
        spec: {
          oneofKind: 'imageSpec',
          imageSpec: {
            prompt: normalizeText(value.prompt),
            negativePrompt: normalizeText(value.negativePrompt),
            n: Number(value.n || 0),
            size: normalizeText(value.size),
            aspectRatio: normalizeText(value.aspectRatio),
            quality: normalizeText(value.quality),
            style: normalizeText(value.style),
            seed: String(value.seed || 0),
            referenceImages: Array.isArray(value.referenceImages) ? value.referenceImages : [],
            providerOptions: toProtoStruct(value.providerOptions),
            mask: normalizeText(value.mask),
            responseFormat: normalizeText(value.responseFormat),
          },
        },
      };
    }

    if (input.modal === 'video') {
      const value = input.input as VideoGenerateInput;
      return {
        ...base,
        modal: Modal.VIDEO,
        spec: {
          oneofKind: 'videoSpec',
          videoSpec: {
            prompt: normalizeText(value.prompt),
            negativePrompt: normalizeText(value.negativePrompt),
            durationSec: Number(value.durationSec || 0),
            fps: Number(value.fps || 0),
            resolution: normalizeText(value.resolution),
            aspectRatio: normalizeText(value.aspectRatio),
            seed: String(value.seed || 0),
            firstFrameUri: normalizeText(value.firstFrameUri),
            lastFrameUri: normalizeText(value.lastFrameUri),
            cameraMotion: normalizeText(value.cameraMotion),
            providerOptions: toProtoStruct(value.providerOptions),
          },
        },
      };
    }

    if (input.modal === 'tts') {
      const value = input.input as SpeechSynthesizeInput;
      return {
        ...base,
        modal: Modal.TTS,
        spec: {
          oneofKind: 'speechSpec',
          speechSpec: {
            text: normalizeText(value.text),
            voice: normalizeText(value.voice),
            language: normalizeText(value.language),
            audioFormat: normalizeText(value.audioFormat),
            sampleRateHz: Number(value.sampleRateHz || 0),
            speed: Number(value.speed || 0),
            pitch: Number(value.pitch || 0),
            volume: Number(value.volume || 0),
            emotion: normalizeText(value.emotion),
            providerOptions: toProtoStruct(value.providerOptions),
          },
        },
      };
    }

    const value = input.input as SpeechTranscribeInput;
    const audioSource = value.audio.kind === 'bytes'
      ? {
        source: {
          oneofKind: 'audioBytes' as const,
          audioBytes: value.audio.bytes,
        },
      }
      : value.audio.kind === 'url'
        ? {
          source: {
            oneofKind: 'audioUri' as const,
            audioUri: normalizeText(value.audio.url),
          },
        }
        : {
          source: {
            oneofKind: 'audioChunks' as const,
            audioChunks: {
              chunks: value.audio.chunks,
            },
          },
        };

    return {
      ...base,
      modal: Modal.STT,
      spec: {
        oneofKind: 'transcriptionSpec',
        transcriptionSpec: {
          audioBytes: value.audio.kind === 'bytes' ? value.audio.bytes : new Uint8Array(0),
          audioUri: value.audio.kind === 'url' ? normalizeText(value.audio.url) : '',
          mimeType: normalizeText(value.mimeType || 'audio/wav'),
          language: normalizeText(value.language),
          timestamps: Boolean(value.timestamps),
          diarization: Boolean(value.diarization),
          speakerCount: Number(value.speakerCount || 0),
          prompt: normalizeText(value.prompt),
          audioSource,
          responseFormat: normalizeText(value.responseFormat),
          providerOptions: toProtoStruct(value.providerOptions),
        },
      },
    };
  }

  async #waitForMediaJobCompletion(
    jobId: string,
    input: {
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<MediaJob> {
    const timeoutMs = Number(input.timeoutMs || this.#options.timeoutMs || DEFAULT_MEDIA_TIMEOUT_MS)
      || DEFAULT_MEDIA_TIMEOUT_MS;
    const startedAt = Date.now();

    let cancelRequested = false;

    const cancel = async (reason: string): Promise<void> => {
      if (cancelRequested) {
        return;
      }
      cancelRequested = true;
      try {
        await this.#cancelMediaJob({
          jobId,
          reason,
        });
      } catch {
        // best effort cancellation
      }
    };

    while (true) {
      if (input.signal?.aborted) {
        await cancel('aborted_by_abort_signal');
        throw createNimiError({
          message: 'media job aborted',
          reasonCode: ReasonCode.OPERATION_ABORTED,
          actionHint: 'retry_media_job_request',
          source: 'runtime',
        });
      }

      const job = await this.#getMediaJob(jobId);

      this.#eventBus.emit('media.job.status', {
        jobId,
        status: mediaStatusToString(job.status),
        at: nowIso(),
      });

      if (job.status === MediaJobStatus.COMPLETED) {
        return job;
      }

      if (
        job.status === MediaJobStatus.FAILED
        || job.status === MediaJobStatus.CANCELED
        || job.status === MediaJobStatus.TIMEOUT
      ) {
        throw createNimiError({
          message: normalizeText(job.reasonDetail) || `media job failed: ${job.reasonCode}`,
          reasonCode: normalizeText(job.reasonCode) || ReasonCode.AI_PROVIDER_UNAVAILABLE,
          actionHint: 'retry_media_job_request',
          source: 'runtime',
        });
      }

      if ((Date.now() - startedAt) > timeoutMs) {
        await cancel('aborted_by_sdk_timeout');
        throw createNimiError({
          message: 'media job timeout',
          reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
          actionHint: 'retry_media_job_request',
          source: 'runtime',
        });
      }

      await sleep(DEFAULT_MEDIA_POLL_INTERVAL_MS);
    }
  }

  async #generateImage(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
    const submitted = await this.#submitMediaJob({
      modal: 'image',
      input,
    });

    const job = await this.#waitForMediaJobCompletion(submitted.jobId, {
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    const artifacts = await this.#getMediaArtifacts(job.jobId);

    const trace = toTraceInfo({
      traceId: artifacts.traceId || job.traceId,
      modelResolved: job.modelResolved,
      routeDecision: job.routeDecision,
    });

    return {
      job,
      artifacts: artifacts.artifacts,
      trace,
    };
  }

  async #generateVideo(input: VideoGenerateInput): Promise<VideoGenerateOutput> {
    const submitted = await this.#submitMediaJob({
      modal: 'video',
      input,
    });

    const job = await this.#waitForMediaJobCompletion(submitted.jobId, {
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    const artifacts = await this.#getMediaArtifacts(job.jobId);

    const trace = toTraceInfo({
      traceId: artifacts.traceId || job.traceId,
      modelResolved: job.modelResolved,
      routeDecision: job.routeDecision,
    });

    return {
      job,
      artifacts: artifacts.artifacts,
      trace,
    };
  }

  async #synthesizeSpeech(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeOutput> {
    const submitted = await this.#submitMediaJob({
      modal: 'tts',
      input,
    });

    const job = await this.#waitForMediaJobCompletion(submitted.jobId, {
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    const artifacts = await this.#getMediaArtifacts(job.jobId);

    const trace = toTraceInfo({
      traceId: artifacts.traceId || job.traceId,
      modelResolved: job.modelResolved,
      routeDecision: job.routeDecision,
    });

    return {
      job,
      artifacts: artifacts.artifacts,
      trace,
    };
  }

  async #transcribeSpeech(input: SpeechTranscribeInput): Promise<SpeechTranscribeOutput> {
    const submitted = await this.#submitMediaJob({
      modal: 'stt',
      input,
    });

    const job = await this.#waitForMediaJobCompletion(submitted.jobId, {
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });

    const artifacts = await this.#getMediaArtifacts(job.jobId);
    const first = artifacts.artifacts[0];
    const text = first ? this.#decodeUtf8(first.bytes) : '';

    const trace = toTraceInfo({
      traceId: artifacts.traceId || job.traceId,
      modelResolved: job.modelResolved,
      routeDecision: job.routeDecision,
    });

    return {
      job,
      text,
      trace,
    };
  }

  async #streamImage(input: ImageGenerateInput): Promise<AsyncIterable<ArtifactChunk>> {
    const output = await this.#generateImage(input);
    return this.#streamArtifactsFromMediaOutput(output);
  }

  async #streamVideo(input: VideoGenerateInput): Promise<AsyncIterable<ArtifactChunk>> {
    const output = await this.#generateVideo(input);
    return this.#streamArtifactsFromMediaOutput(output);
  }

  async #streamSpeech(input: SpeechSynthesizeInput): Promise<AsyncIterable<ArtifactChunk>> {
    const output = await this.#synthesizeSpeech(input);
    return this.#streamArtifactsFromMediaOutput(output);
  }

  async #listSpeechVoices(input: SpeechListVoicesInput): Promise<SpeechListVoicesOutput> {
    const subjectUserId = await this.#resolveSubjectUserId(input.subjectUserId);
    const request: GetSpeechVoicesRequest = {
      appId: this.appId,
      subjectUserId,
      modelId: ensureText(input.model, 'model'),
      routePolicy: toRoutePolicy(input.route),
      fallback: toFallbackPolicy(input.fallback),
      connectorId: '',
    };

    const response = await this.#invokeWithClient(async (client) => client.ai.getSpeechVoices(
      request,
      this.#resolveRuntimeCallOptions({
        metadata: input.metadata,
      }),
    ));

    return {
      voices: (response.voices || []).map((v: SpeechVoiceDescriptor) => ({
        voiceId: normalizeText(v.voiceId),
        name: normalizeText(v.name),
        lang: normalizeText(v.lang),
        supportedLangs: v.supportedLangs || [],
      })),
      modelResolved: normalizeText(response.modelResolved),
      traceId: normalizeText(response.traceId),
    };
  }

  async #streamSpeechSynthesis(input: SpeechStreamSynthesisInput): Promise<AsyncIterable<ArtifactChunk>> {
    const subjectUserId = await this.#resolveSubjectUserId(input.subjectUserId);
    const request: StreamSpeechSynthesisRequest = {
      appId: this.appId,
      subjectUserId,
      modelId: ensureText(input.model, 'model'),
      speechSpec: {
        text: normalizeText(input.text),
        voice: normalizeText(input.voice),
        language: normalizeText(input.language),
        audioFormat: normalizeText(input.audioFormat),
        sampleRateHz: Number(input.sampleRateHz || 0),
        speed: Number(input.speed || 0),
        pitch: Number(input.pitch || 0),
        volume: Number(input.volume || 0),
        emotion: normalizeText(input.emotion),
        providerOptions: toProtoStruct(input.providerOptions),
      },
      routePolicy: toRoutePolicy(input.route),
      fallback: toFallbackPolicy(input.fallback),
      timeoutMs: Number(input.timeoutMs || this.#options.timeoutMs || 0),
      connectorId: '',
    };

    return this.#invokeWithClient(async (client) => client.ai.synthesizeSpeechStream(
      request,
      this.#resolveRuntimeStreamOptions({
        timeoutMs: input.timeoutMs,
        metadata: input.metadata,
      }),
    ));
  }

  #streamArtifactsFromMediaOutput(
    output: {
      job: MediaJob;
      artifacts: Array<{
        artifactId: string;
        mimeType: string;
        bytes: Uint8Array;
      }>;
      trace: NimiTraceInfo;
    },
  ): AsyncIterable<ArtifactChunk> {
    const chunkSize = 64 * 1024;
    const routeDecision = output.job.routeDecision || RoutePolicy.UNSPECIFIED;
    const modelResolved = normalizeText(output.job.modelResolved);
    const traceId = normalizeText(output.trace.traceId || output.job.traceId);
    const usage = output.job.usage;
    const fallbackArtifactId = normalizeText(output.job.jobId);
    const fallbackMimeType = 'application/octet-stream';

    const sourceArtifacts = output.artifacts.length > 0
      ? output.artifacts
      : [
          {
            artifactId: fallbackArtifactId,
            mimeType: fallbackMimeType,
            bytes: new Uint8Array(0),
          },
        ];

    const items = sourceArtifacts.flatMap((artifact) => {
      const artifactId = normalizeText(artifact.artifactId) || fallbackArtifactId;
      const mimeType = normalizeText(artifact.mimeType) || fallbackMimeType;
      const bytes = artifact.bytes ?? new Uint8Array(0);
      if (bytes.length === 0) {
        return [{
          artifactId,
          mimeType,
          chunk: new Uint8Array(0),
        }];
      }

      const parts: Array<{
        artifactId: string;
        mimeType: string;
        chunk: Uint8Array;
      }> = [];
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        parts.push({
          artifactId,
          mimeType,
          chunk: bytes.slice(offset, Math.min(bytes.length, offset + chunkSize)),
        });
      }
      return parts;
    });

    return (async function* (): AsyncIterable<ArtifactChunk> {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (!item) {
          continue;
        }
        const isLastChunk = index === items.length - 1;
        yield {
          artifactId: item.artifactId,
          mimeType: item.mimeType,
          sequence: String(index),
          chunk: item.chunk,
          eof: isLastChunk,
          usage: isLastChunk ? usage : undefined,
          routeDecision,
          modelResolved,
          traceId,
        };
      }
    }());
  }

  #decodeUtf8(input: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input).toString('utf8');
    }
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(input);
    }
    let output = '';
    for (let index = 0; index < input.length; index += 1) {
      output += String.fromCharCode(input[index] || 0);
    }
    return output;
  }
}
