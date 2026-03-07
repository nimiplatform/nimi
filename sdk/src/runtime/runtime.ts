import { createEventBus } from '../internal/event-bus.js';
import { createScopeModule, type ScopeModule } from '../scope/index.js';
import { ReasonCode } from '../types/index.js';
import { asNimiError, createNimiError } from './errors.js';
import { RuntimeMethodIds } from './method-ids.js';
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
  PHASE2_AUDIT_METHOD_IDS,
  PHASE2_MODULE_KEYS,
  RUNTIME_METHOD_LOOKUP,
  SDK_RUNTIME_MAJOR_VERSION,
  normalizeText,
  nowIso,
  resolveHealthStatus,
  toIsoFromTimestamp,
} from './helpers.js';
import {
  createCorePassthroughClients,
  createHealthEventStreams,
  createAiModule,
  createAppAuthClient,
  createAppClient,
  createMediaModule,
  createRawModule,
  createRuntimeEventsModule,
  createScopeClient,
  emitAuthTokenIssuedEvent,
  emitAuthTokenRevokedEvent,
} from './runtime-modules.js';
import {
  ensureRuntimeClientForCall,
  invokeWithRuntimeRetry,
  resolveReadyTimeout,
  resolveRuntimeCallOptions,
  resolveRuntimeStreamOptions,
  waitForRuntimeReady,
} from './runtime-infra.js';
import {
  assertRuntimeMethodAvailable,
  checkRuntimeVersionCompatibility,
  resolveOptionalRuntimeSubjectUserId,
  resolveRuntimeSubjectUserId,
  wrapModeDStream,
} from './runtime-guards.js';
import { runtimeRawCall } from './runtime-raw-call.js';
import { closeRuntime, connectRuntime, readyRuntime } from './runtime-lifecycle.js';

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
      resolveRuntimeCallOptions: (input) => resolveRuntimeCallOptions(this.#options, input),
      resolveRuntimeStreamOptions: (input) => resolveRuntimeStreamOptions(this.#options, input),
      resolveSubjectUserId: (explicit) => resolveRuntimeSubjectUserId({
        explicit,
        subjectContext: this.#options.subjectContext,
      }),
      resolveOptionalSubjectUserId: (explicit) => resolveOptionalRuntimeSubjectUserId({
        explicit,
        subjectContext: this.#options.subjectContext,
      }),
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
    };

    this.events = createRuntimeEventsModule(this.#eventBus);

    const createMethodNotImplementedError = (moduleKey: string, methodKey: string) => createNimiError({
      message: `${String(moduleKey)}.${methodKey} is not implemented`,
      reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
      actionHint: 'check_runtime_method_mapping',
      source: 'sdk',
    });
    const passthrough = createCorePassthroughClients({
      assertMethodAvailable: (moduleKey, methodKey) => this.#assertMethodAvailable(moduleKey, methodKey),
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
      createMethodNotImplementedError,
    });
    this.auth = passthrough.auth;
    this.workflow = passthrough.workflow;
    this.model = passthrough.model;
    this.localRuntime = passthrough.localRuntime;
    this.connector = passthrough.connector;
    this.knowledge = passthrough.knowledge;
    this.audit = passthrough.audit;
    this.scriptWorker = passthrough.scriptWorker;
    const healthStreams = createHealthEventStreams({
      audit: this.audit,
      wrapModeDStream: (source) => this.#wrapModeDStream(source),
    });
    this.healthEvents = healthStreams.healthEvents;
    this.providerHealthEvents = healthStreams.providerHealthEvents;

    this.app = createAppClient((operation) => this.#invokeWithClient(operation));

    this.appAuth = createAppAuthClient({
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
      resolvePublishedCatalogVersion: (requested) => this.#scopeModule.resolvePublishedCatalogVersion(requested),
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
      authEvents: {
        emitTokenIssued: (tokenId) => emitAuthTokenIssuedEvent(this.#eventBus, tokenId),
        emitTokenRevoked: (tokenId) => emitAuthTokenRevokedEvent(this.#eventBus, tokenId),
      },
    });

    this.scope = createScopeClient({
      invoke: (operation) => this.#invoke(operation),
      scopeModule: this.#scopeModule,
    });

    const ctx = this.#ctx;

    this.ai = createAiModule({
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
      ctx,
    });

    this.media = createMediaModule(ctx);

    this.raw = createRawModule({
      rawCall: (methodId, inputValue, optionsValue) => runtimeRawCall({
        methodId,
        request: inputValue,
        options: optionsValue,
        methodLookup: RUNTIME_METHOD_LOOKUP,
        assertMethodAvailable: (moduleKey, methodKey) => this.#assertMethodAvailable(moduleKey, methodKey),
        invokeWithClient: (operation) => this.#invokeWithClient(operation),
        createMethodNotAllowlistedError: (missingMethodId) => createNimiError({
          message: `runtime method is not allowlisted: ${missingMethodId}`,
          reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
          actionHint: 'use_runtime_method_ids',
          source: 'sdk',
        }),
        createMethodNotImplementedError: (moduleKey, methodKey) => createNimiError({
          message: `${moduleKey}.${methodKey} is not implemented`,
          reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
          actionHint: 'check_runtime_method_mapping',
          source: 'sdk',
        }),
      }),
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
    });
  }

  async connect(): Promise<void> {
    await connectRuntime({
      appId: this.appId,
      options: this.#options,
      state: this.#state,
      connectPromise: this.#connectPromise,
      setState: (state) => {
        this.#state = state;
      },
      setConnectPromise: (promise) => {
        this.#connectPromise = promise;
      },
      setClient: (client) => {
        this.#client = client;
      },
      emitConnected: (at) => {
        this.#eventBus.emit('runtime.connected', { at });
      },
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
    });
  }

  async ready(input?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = this.#resolveReadyTimeout(input?.timeoutMs);
    await readyRuntime({
      timeoutMs,
      waitForReady: (effectiveTimeoutMs) => this.#waitForReady(effectiveTimeoutMs),
      health: () => this.health(),
      markReady: (at) => {
        this.#state = {
          ...this.#state,
          status: 'ready',
          lastReadyAt: at,
        };
      },
    });
  }

  async close(input?: { force?: boolean }): Promise<void> {
    void input;
    closeRuntime({
      state: this.#state,
      setState: (state) => {
        this.#state = state;
      },
      setClient: (client) => {
        this.#client = client;
      },
      emitDisconnected: (at) => {
        this.#eventBus.emit('runtime.disconnected', { at });
      },
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
    });
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
    return resolveReadyTimeout(this.#options, timeoutMs);
  }

  async #waitForReady(timeoutMs: number): Promise<void> {
    await waitForRuntimeReady({
      stateStatus: this.#state.status,
      mode: this.#options.connection?.mode || 'auto',
      connectPromise: this.#connectPromise,
      connect: () => this.connect(),
      timeoutMs,
    });
  }

  async #ensureClientForCall(): Promise<RuntimeClient> {
    return ensureRuntimeClientForCall({
      options: this.#options,
      stateStatus: this.#state.status,
      client: this.#client,
      waitForReady: (timeoutMs) => this.#waitForReady(timeoutMs),
      getClient: () => this.#client,
    });
  }

  async #invokeWithClient<T>(operation: (client: RuntimeClient) => Promise<T>): Promise<T> {
    return this.#invoke(async () => {
      const client = await this.#ensureClientForCall();
      return operation(client);
    });
  }

  async #invoke<T>(operation: () => Promise<T>): Promise<T> {
    return invokeWithRuntimeRetry({
      operation,
      options: this.#options,
      normalizeError: (error) => asNimiError(error, {
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'retry_or_check_runtime_status',
        source: 'runtime',
      }),
      onRecovered: (attempt) => {
        if (this.#state.status !== 'ready') {
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
      },
      onRetry: (normalized, attempt, backoffMs, maxAttempts) => {
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
        this.#emitTelemetry('runtime.retry', {
          attempt,
          maxAttempts,
          backoffMs,
          reasonCode: normalized.reasonCode,
        });
      },
      onTerminalError: (normalized) => {
        this.#eventBus.emit('error', {
          error: normalized,
          at: nowIso(),
        });
        this.#emitTelemetry('runtime.error', {
          reasonCode: normalized.reasonCode,
          actionHint: normalized.actionHint,
          traceId: normalized.traceId,
        });
      },
    });
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
    this.#versionChecked = checkRuntimeVersionCompatibility({
      version,
      versionChecked: this.#versionChecked,
      sdkRuntimeMajor: SDK_RUNTIME_MAJOR_VERSION,
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
      emitError: (error) => this.#eventBus.emit('error', { error, at: nowIso() }),
    });
  }

  #assertMethodAvailable(moduleKey: string, methodKey: string): void {
    assertRuntimeMethodAvailable({
      moduleKey,
      methodKey,
      runtimeVersion: this.#runtimeVersion,
      sdkRuntimeMajor: SDK_RUNTIME_MAJOR_VERSION,
      phase2ModuleKeys: PHASE2_MODULE_KEYS,
      phase2AuditMethodIds: PHASE2_AUDIT_METHOD_IDS,
      auditMethodIds: RuntimeMethodIds.audit as Record<string, string>,
    });
  }

  #wrapModeDStream<T>(source: AsyncIterable<T>): AsyncIterable<T> {
    return wrapModeDStream({
      source,
      onCancelled: () => {
        this.#eventBus.emit('runtime.disconnected', {
          at: nowIso(),
          reasonCode: ReasonCode.RUNTIME_GRPC_CANCELLED,
        });
        this.#emitTelemetry('runtime.mode-d.cancelled', {
          at: nowIso(),
        });
      },
    });
  }
}
