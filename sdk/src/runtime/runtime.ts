import { createEventBus } from '../internal/event-bus.js';
import { createScopeModule, type ScopeModule } from '../scope/index.js';
import { ReasonCode, type NimiError } from '../types/index.js';
import { asNimiError, createNimiError } from './errors.js';
import {
  RoutePolicy,
} from './generated/runtime/v1/ai';
import { RuntimeHealthStatus } from './generated/runtime/v1/audit';
import { RuntimeMethodIds } from './method-ids.js';
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
  RuntimeScriptWorkerClient,
  RuntimeStreamCallOptions,
  RuntimeTransportConfig,
  RuntimeWorkflowClient,
} from './types.js';
import type {
  RuntimeAiModule,
  RuntimeConnectionMode,
  RuntimeConnectionState,
  RuntimeEventPayloadMap,
  RuntimeHealth,
  RuntimeMediaModule,
  RuntimeMethod,
  RuntimeOptions,
  RuntimeRawModule,
  RuntimeScopeModule,
  RuntimeEventsModule,
} from './types.js';
import type { RuntimeInternalContext } from './internal-context.js';
import {
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_WAIT_FOR_READY_TIMEOUT_MS,
  MAX_RETRY_BACKOFF_MS,
  PHASE2_AUDIT_METHOD_IDS,
  PHASE2_MODULE_KEYS,
  RETRYABLE_RUNTIME_REASON_CODES,
  RUNTIME_METHOD_LOOKUP,
  SDK_RUNTIME_MAJOR_VERSION,
  normalizeText,
  nowIso,
  parseSemverMajor,
  resolveHealthStatus,
  sleep,
  toIsoFromTimestamp,
  wrapModeBMediaStream,
  wrapModeBWorkflowStream,
} from './helpers.js';
import {
  runtimeGenerateText,
  runtimeStreamText,
  runtimeGenerateEmbedding,
} from './runtime-ai-text.js';
import {
  runtimeSubmitMediaJob,
  runtimeGetMediaJob,
  runtimeCancelMediaJob,
  runtimeSubscribeMediaJob,
  runtimeGetMediaArtifacts,
} from './runtime-media.js';
import {
  runtimeGenerateImage,
  runtimeGenerateVideo,
  runtimeSynthesizeSpeech,
  runtimeTranscribeSpeech,
  runtimeStreamImage,
  runtimeStreamVideo,
  runtimeStreamSpeech,
  runtimeListSpeechVoices,
  runtimeStreamSpeechSynthesis,
} from './runtime-modality.js';

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

  readonly scriptWorker: RuntimeScriptWorkerClient;

  readonly healthEvents: (
    request?: import('./generated/runtime/v1/audit').SubscribeRuntimeHealthEventsRequest,
    options?: RuntimeStreamCallOptions,
  ) => Promise<AsyncIterable<import('./generated/runtime/v1/audit').RuntimeHealthEvent>>;

  readonly providerHealthEvents: (
    request?: import('./generated/runtime/v1/audit').SubscribeAIProviderHealthEventsRequest,
    options?: RuntimeStreamCallOptions,
  ) => Promise<AsyncIterable<import('./generated/runtime/v1/audit').AIProviderHealthEvent>>;

  readonly scope: RuntimeScopeModule;

  readonly events: RuntimeEventsModule;

  readonly raw: RuntimeRawModule;

  readonly transport: RuntimeTransportConfig;

  #client: RuntimeClient | null = null;

  #connectPromise: Promise<void> | null = null;

  #state: RuntimeConnectionState = {
    status: 'idle',
  };

  #runtimeVersion: string | null = null;

  #versionChecked = false;

  readonly #options: RuntimeOptions;

  readonly #scopeModule: ScopeModule;

  readonly #eventBus = createEventBus<RuntimeEventPayloadMap>();

  readonly #ctx: RuntimeInternalContext;

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

    const transportWithObserver = {
      ...options.transport,
      _responseMetadataObserver: (metadata: Record<string, string>) => {
        const version = metadata['x-nimi-runtime-version'];
        if (version && !this.#runtimeVersion) {
          this.#runtimeVersion = version;
          this.#emitTelemetry('runtime.version.detected', { version });
          this.#checkVersionCompatibility(version);
        }
      },
    };

    this.#options = {
      ...options,
      appId: this.appId,
      transport: transportWithObserver,
      connection: {
        mode: options.connection?.mode || 'auto',
        waitForReadyTimeoutMs: options.connection?.waitForReadyTimeoutMs,
      },
    };

    this.#scopeModule = createScopeModule({ appId: this.appId });

    this.#ctx = {
      appId: this.appId,
      options: this.#options,
      invoke: (op) => this.#invoke(op),
      invokeWithClient: (op) => this.#invokeWithClient(op),
      resolveRuntimeCallOptions: (input) => this.#resolveRuntimeCallOptions(input),
      resolveRuntimeStreamOptions: (input) => this.#resolveRuntimeStreamOptions(input),
      resolveSubjectUserId: (explicit) => this.#resolveSubjectUserId(explicit),
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
    };

    this.events = {
      on: (name, handler) => this.#eventBus.on(name, handler),
      once: (name, handler) => this.#eventBus.once(name, handler),
    };

    this.auth = this.#createPassthroughModule('auth') as RuntimeAuthClient;
    const workflowPassthrough = this.#createPassthroughModule('workflow') as RuntimeWorkflowClient;
    this.workflow = {
      submit: workflowPassthrough.submit,
      get: workflowPassthrough.get,
      cancel: workflowPassthrough.cancel,
      subscribeEvents: async (request, optionsValue) => {
        const raw = await workflowPassthrough.subscribeEvents(request, optionsValue);
        return wrapModeBWorkflowStream(raw);
      },
    };
    this.model = this.#createPassthroughModule('model') as RuntimeModelClient;
    this.localRuntime = this.#createPassthroughModule('localRuntime') as RuntimeLocalRuntimeClient;
    this.connector = this.#createPassthroughModule('connector') as RuntimeConnectorClient;
    this.knowledge = this.#createPassthroughModule('knowledge') as RuntimeKnowledgeClient;
    this.audit = this.#createPassthroughModule('audit') as RuntimeAuditClient;
    this.scriptWorker = this.#createPassthroughModule('scriptWorker') as RuntimeScriptWorkerClient;

    this.healthEvents = async (request, optionsValue) => {
      const raw = await this.audit.subscribeRuntimeHealthEvents(
        request || {},
        optionsValue,
      );
      return this.#wrapModeDStream(raw);
    };

    this.providerHealthEvents = async (request, optionsValue) => {
      const raw = await this.audit.subscribeAIProviderHealthEvents(
        request || {},
        optionsValue,
      );
      return this.#wrapModeDStream(raw);
    };

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

    const ctx = this.#ctx;

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
      subscribeMediaJobEvents: async (request, optionsValue) => {
        const raw = await this.#invokeWithClient(
          async (client) => client.ai.subscribeMediaJobEvents(request, optionsValue),
        );
        return wrapModeBMediaStream(raw);
      },
      getMediaResult: async (request, optionsValue) => this.#invokeWithClient(
        async (client) => client.ai.getMediaResult(request, optionsValue),
      ),
      text: {
        generate: async (input) => runtimeGenerateText(ctx, input),
        stream: async (input) => runtimeStreamText(ctx, input),
      },
      embedding: {
        generate: async (input) => runtimeGenerateEmbedding(ctx, input),
      },
    };

    this.media = {
      image: {
        generate: async (input) => runtimeGenerateImage(ctx, input),
        stream: async (input) => runtimeStreamImage(ctx, input),
      },
      video: {
        generate: async (input) => runtimeGenerateVideo(ctx, input),
        stream: async (input) => runtimeStreamVideo(ctx, input),
      },
      tts: {
        synthesize: async (input) => runtimeSynthesizeSpeech(ctx, input),
        stream: async (input) => runtimeStreamSpeech(ctx, input),
        listVoices: async (input) => runtimeListSpeechVoices(ctx, input),
        streamSynthesis: (input) => runtimeStreamSpeechSynthesis(ctx, input),
      },
      stt: {
        transcribe: async (input) => runtimeTranscribeSpeech(ctx, input),
      },
      jobs: {
        submit: async (input) => runtimeSubmitMediaJob(ctx, input),
        get: async (jobId) => runtimeGetMediaJob(ctx, jobId),
        cancel: async (input) => runtimeCancelMediaJob(ctx, input),
        subscribe: async (jobId) => runtimeSubscribeMediaJob(ctx, jobId),
        getArtifacts: async (jobId) => runtimeGetMediaArtifacts(ctx, jobId),
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

  runtimeVersion(): string | null {
    return this.#runtimeVersion;
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

  // ── Private infrastructure methods ──────────────────────────────────

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
    moduleKey: keyof Pick<RuntimeClient, 'auth' | 'workflow' | 'model' | 'localRuntime' | 'connector' | 'knowledge' | 'audit' | 'scriptWorker'>,
  ): Module {
    return new Proxy({} as Module, {
      get: (_target, property: string | symbol) => {
        if (typeof property !== 'string') {
          return undefined;
        }

        return async (...args: unknown[]) => {
          this.#assertMethodAvailable(moduleKey, property);
          return this.#invokeWithClient(async (client) => {
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
        };
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

  #checkVersionCompatibility(version: string): void {
    if (this.#versionChecked) {
      return;
    }
    this.#versionChecked = true;

    const runtimeMajor = parseSemverMajor(version);
    if (runtimeMajor === null) {
      this.#emitTelemetry('runtime.version.unparseable', { version });
      return;
    }

    if (runtimeMajor !== SDK_RUNTIME_MAJOR_VERSION) {
      const error = createNimiError({
        message: `runtime major version ${runtimeMajor} is incompatible with SDK major version ${SDK_RUNTIME_MAJOR_VERSION}`,
        reasonCode: ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE,
        actionHint: 'upgrade_sdk_or_runtime',
        source: 'sdk',
      });
      this.#eventBus.emit('error', { error, at: nowIso() });
      throw error;
    }

    this.#emitTelemetry('runtime.version.compatible', {
      runtimeVersion: version,
      sdkMajor: SDK_RUNTIME_MAJOR_VERSION,
    });
  }

  #assertMethodAvailable(moduleKey: string, methodKey: string): void {
    const isPhase2Module = PHASE2_MODULE_KEYS.has(moduleKey);
    const isPhase2AuditMethod = moduleKey === 'audit'
      && PHASE2_AUDIT_METHOD_IDS.has(
        (RuntimeMethodIds.audit as Record<string, string>)[methodKey] || '',
      );

    if (!isPhase2Module && !isPhase2AuditMethod) {
      return;
    }

    if (!this.#runtimeVersion) {
      return;
    }

    const runtimeMajor = parseSemverMajor(this.#runtimeVersion);
    if (runtimeMajor === null) {
      return;
    }

    if (runtimeMajor < SDK_RUNTIME_MAJOR_VERSION) {
      throw createNimiError({
        message: `${moduleKey}.${methodKey} is unavailable: runtime version ${this.#runtimeVersion} does not support this Phase 2 method`,
        reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
        actionHint: 'upgrade_runtime_to_support_method',
        source: 'sdk',
      });
    }
  }

  #wrapModeDStream<T>(source: AsyncIterable<T>): AsyncIterable<T> {
    const owner = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          yield* source;
        } catch (error) {
          const normalized = asNimiError(error, {
            reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
            source: 'runtime',
          });
          const isCancelled = normalized.reasonCode === ReasonCode.RUNTIME_GRPC_CANCELLED
            || normalized.message.includes(ReasonCode.RUNTIME_GRPC_CANCELLED);
          if (isCancelled) {
            owner.#eventBus.emit('runtime.disconnected', {
              at: nowIso(),
              reasonCode: ReasonCode.RUNTIME_GRPC_CANCELLED,
            });
            owner.#emitTelemetry('runtime.mode-d.cancelled', {
              at: nowIso(),
            });
            return;
          }
          throw normalized;
        }
      },
    };
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
    const traceId = normalizeText(
      metadataInput['x-nimi-trace-id'] || metadataInput.traceId,
    ) || undefined;
    const keySourceRaw = normalizeText(
      metadataInput['x-nimi-key-source'] || metadataInput.keySource,
    ).toLowerCase();
    const keySource: 'inline' | 'managed' | undefined = keySourceRaw === 'inline' || keySourceRaw === 'managed'
      ? keySourceRaw
      : undefined;
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
          && normalizedKey !== 'x-nimi-trace-id'
          && normalizedKey !== 'traceid'
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
      traceId,
      keySource,
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

    this.#assertMethodAvailable(binding.moduleKey, binding.methodKey);

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
}
