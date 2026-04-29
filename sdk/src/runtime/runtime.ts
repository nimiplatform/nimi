import { createEventBus } from '../internal/event-bus.js';
import type { JsonObject } from '../internal/utils.js';
import { createScopeModule, type ScopeModule } from '../scope/index.js';
import { ReasonCode, type VersionCompatibilityStatus } from '../types/index.js';
import { asNimiError, createNimiError } from './errors.js';
import { RuntimeMethodIds } from './method-ids.js';
import type {
  RuntimeMethodId,
  RuntimeMethodRequest,
  RuntimeMethodResponse,
} from './runtime-method-contracts.js';
import type {
  RuntimeAppAuthClient,
  RuntimeAccountClient,
  RuntimeAgentModule,
  RuntimeAuditClient,
  RuntimeAuthClient,
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeConnectorClient,
  RuntimeKnowledgeClient,
  RuntimeLocalServiceClient,
  RuntimeMemoryClient,
  RuntimeModelClient,
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
  RuntimeScopeModule,
  RuntimeUnsafeRawModule,
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
  attachRuntimeAgentSurface,
  createRuntimeAgentAnchorsModule,
  createRuntimeAgentTurnsModule,
} from './runtime-agent-surface.js';
import { createRuntimeProtectedScopeHelper } from './protected-access.js';
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
  runtimeAiRequestRequiresSubject,
  checkRuntimeVersionCompatibility,
  resolveOptionalRuntimeSubjectUserId,
  resolveRuntimeSubjectUserId,
  wrapModeDStream,
} from './runtime-guards.js';
import { runtimeRawCall } from './runtime-raw-call.js';
import { closeRuntime, connectRuntime, readyRuntime } from './runtime-lifecycle.js';
import { FallbackPolicy } from './generated/runtime/v1/ai.js';
import {
  runtimeGenerateConvenience,
  runtimeStreamConvenience,
  type RuntimeGenerateInput,
  type RuntimeGenerateResult,
  type RuntimeStreamChunk,
  type RuntimeStreamInput,
} from './runtime-convenience.js';

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process?.versions?.node);
}

function readNodeEnv(name: string): string {
  if (!isNodeRuntime()) {
    return '';
  }
  return normalizeText(process.env?.[name]);
}

export class Runtime {
  readonly appId: string;
  readonly auth: RuntimeAuthClient;
  readonly appAuth: RuntimeAppAuthClient;
  readonly account: RuntimeAccountClient;
  readonly ai: RuntimeAiModule;
  readonly media: RuntimeMediaModule;
  readonly workflow: RuntimeWorkflowClient;
  readonly model: RuntimeModelClient;
  readonly local: RuntimeLocalServiceClient;
  readonly connector: RuntimeConnectorClient;
  readonly knowledge: RuntimeKnowledgeClient;
  readonly memory: RuntimeMemoryClient;
  readonly agent: RuntimeAgentModule;
  readonly app: {
    sendMessage: RuntimeClient['app']['sendAppMessage'];
    subscribeMessages: RuntimeClient['app']['subscribeAppMessages'];
  };
  readonly audit: RuntimeAuditClient;
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
  readonly unsafeRaw: RuntimeUnsafeRawModule;
  readonly transport: RuntimeTransportConfig;
  #client: RuntimeClient | null = null;
  #connectPromise: Promise<void> | null = null;
  #state: RuntimeConnectionState = {
    status: 'idle',
  };
  #retryTransitionEpoch = 0;
  #runtimeVersion: string | null = null;
  #versionCompatibility: VersionCompatibilityStatus = {
    state: 'unknown',
    compatible: true,
    checked: false,
    sdkRuntimeMajor: SDK_RUNTIME_MAJOR_VERSION,
    runtimeVersion: null,
    runtimeMajor: null,
    reason: 'metadata_missing',
  };
  #versionChecked = false;
  readonly #options: RuntimeOptions;
  readonly #scopeModule: ScopeModule;
  readonly #eventBus = createEventBus<RuntimeEventPayloadMap>();
  readonly #ctx: RuntimeInternalContext;

  constructor(options: RuntimeOptions = {}) {
    const appIdInput = hasOwn(options, 'appId')
      ? options.appId
      : readNodeEnv('NIMI_APP_ID') || 'nimi.app';
    const normalizedAppId = normalizeText(appIdInput);
    if (!normalizedAppId) {
      throw createNimiError({
        message: 'appId is required',
        reasonCode: ReasonCode.SDK_APP_ID_REQUIRED,
        actionHint: 'set_app_id',
        source: 'sdk',
      });
    }
    this.appId = normalizedAppId;
    const transportInput = options.transport || (isNodeRuntime()
      ? {
        type: 'node-grpc' as const,
        endpoint: readNodeEnv('NIMI_RUNTIME_ENDPOINT') || '127.0.0.1:46371',
      }
      : undefined);
    if (!transportInput) {
      throw createNimiError({
        message: 'transport is required outside Node.js. App-level consumers should use createPlatformClient(); direct Runtime construction only auto-configures transport in Node.js. Otherwise pass transport explicitly (for example node-grpc or tauri-ipc).',
        reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
        actionHint: 'set_transport',
        source: 'sdk',
      });
    }
    this.transport = transportInput;

    const transportWithObserver = {
      ...transportInput,
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
      normalizeScenarioHead: async ({ head, metadata }) => {
        const subjectUserId = runtimeAiRequestRequiresSubject({
          request: { head },
          metadata,
        })
          ? await resolveRuntimeSubjectUserId({
            explicit: head.subjectUserId,
            subjectContext: this.#options.subjectContext,
          })
          : await resolveOptionalRuntimeSubjectUserId({
            explicit: head.subjectUserId,
            subjectContext: this.#options.subjectContext,
          });
        return {
          ...head,
          subjectUserId: subjectUserId || '',
          fallback: head.fallback ?? FallbackPolicy.DENY,
        };
      },
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
    };

    this.events = createRuntimeEventsModule(this.#eventBus);

    const passthrough = createCorePassthroughClients({
      assertMethodAvailable: (moduleKey, methodKey) => this.#assertMethodAvailable(moduleKey, methodKey),
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
    });
    this.auth = passthrough.auth;
    this.account = passthrough.account;
    this.workflow = passthrough.workflow;
    this.model = passthrough.model;
    this.local = passthrough.local;
    this.connector = passthrough.connector;
    this.knowledge = passthrough.knowledge;
    this.memory = passthrough.memory;
    this.audit = passthrough.audit;
    const healthStreams = createHealthEventStreams({
      audit: this.audit,
      wrapModeDStream: (source) => this.#wrapModeDStream(source),
    });
    this.healthEvents = healthStreams.healthEvents;
    this.providerHealthEvents = healthStreams.providerHealthEvents;

    this.app = createAppClient({
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
      wrapModeDStream: (source) => this.#wrapModeDStream(source),
    });

    this.appAuth = createAppAuthClient({
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
      resolvePublishedCatalogVersion: (requested) => this.#scopeModule.resolvePublishedCatalogVersion(requested),
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
      authEvents: {
        emitTokenIssued: (tokenId) => emitAuthTokenIssuedEvent(this.#eventBus, tokenId),
        emitTokenRevoked: (tokenId) => emitAuthTokenRevokedEvent(this.#eventBus, tokenId),
      },
    });

    const protectedScopeHelper = createRuntimeProtectedScopeHelper({
      runtime: {
        appId: this.appId,
        transport: this.transport,
        auth: this.auth,
        appAuth: this.appAuth,
      },
      getSubjectUserId: () => this.#ctx.resolveSubjectUserId(undefined),
    });

    this.agent = attachRuntimeAgentSurface(passthrough.agent, {
      anchors: createRuntimeAgentAnchorsModule({
        appId: this.appId,
        agent: passthrough.agent,
        protectedAccess: protectedScopeHelper,
        resolveSubjectUserId: (explicit) => this.#ctx.resolveSubjectUserId(explicit),
      }),
      turns: createRuntimeAgentTurnsModule({
        appId: this.appId,
        agent: passthrough.agent,
        app: this.app,
        protectedAccess: protectedScopeHelper,
        resolveSubjectUserId: (explicit) => this.#ctx.resolveSubjectUserId(explicit),
      }),
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

    const rawCall: RuntimeUnsafeRawModule['call'] = (
      methodId: string,
      inputValue: unknown,
      optionsValue?: RuntimeCallOptions | RuntimeStreamCallOptions,
    ) => runtimeRawCall({
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
    });

    const unsafeRaw = createRawModule({
      rawCall,
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
    });
    this.unsafeRaw = unsafeRaw;
  }

  async connect(): Promise<void> {
    await connectRuntime({
      appId: this.appId,
      options: this.#options,
      getState: () => this.#state,
      getConnectPromise: () => this.#connectPromise,
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

  async close(): Promise<void> {
    await closeRuntime({
      getState: () => this.#state,
      getConnectPromise: () => this.#connectPromise,
      getClient: () => this.#client,
      setState: (state) => {
        this.#state = state;
      },
      setConnectPromise: (promise) => {
        this.#connectPromise = promise;
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

  versionCompatibility(): VersionCompatibilityStatus {
    return { ...this.#versionCompatibility };
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

  async generate(input: RuntimeGenerateInput): Promise<RuntimeGenerateResult> {
    return runtimeGenerateConvenience(this, input);
  }

  async stream(input: RuntimeStreamInput): Promise<AsyncIterable<RuntimeStreamChunk>> {
    return runtimeStreamConvenience(this, input);
  }

  call<MethodId extends RuntimeMethodId>(
    method: MethodId,
    input: RuntimeMethodRequest<MethodId>,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<RuntimeMethodResponse<MethodId>>;
  call<MethodId extends RuntimeMethodId>(
    method: RuntimeMethod<RuntimeMethodRequest<MethodId>, RuntimeMethodResponse<MethodId>> & { methodId: MethodId },
    input: RuntimeMethodRequest<MethodId>,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<RuntimeMethodResponse<MethodId>>;
  call<TReq, TRes>(
    method: RuntimeMethod<TReq, TRes>,
    input: TReq,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<TRes>;
  call(
    method: RuntimeMethod<unknown, unknown>,
    input: unknown,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<unknown>;
  call(
    method: RuntimeMethod<unknown, unknown> | string,
    input: unknown,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<unknown> {
    const methodId = typeof method === 'string' ? method : method.methodId;
    return this.unsafeRaw.call(methodId, input, options);
  }

  // ── Private infrastructure methods ──────────────────────────────────

  #resolveReadyTimeout(timeoutMs?: number): number {
    return resolveReadyTimeout(this.#options, timeoutMs);
  }

  async #waitForReady(timeoutMs: number): Promise<void> {
    await waitForRuntimeReady({
      stateStatus: this.#state.status,
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
    let retryEpoch: number | null = null;
    return invokeWithRuntimeRetry({
      operation,
      options: this.#options,
      normalizeError: (error) => asNimiError(error, {
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'retry_or_check_runtime_status',
        source: 'runtime',
      }),
      onRecovered: (attempt) => {
        if (this.#state.status === 'closing' || this.#state.status === 'closed') {
          return;
        }
        if (retryEpoch === null || retryEpoch !== this.#retryTransitionEpoch) {
          return;
        }
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
        if (this.#state.status === 'closing' || this.#state.status === 'closed') {
          return;
        }
        retryEpoch = ++this.#retryTransitionEpoch;
        const at = nowIso();
        this.#client = null;
        const wasReady = this.#state.status === 'ready';
        this.#state = {
          ...this.#state,
          status: 'idle',
        };
        if (wasReady) {
          this.#eventBus.emit('runtime.disconnected', {
            at,
            reasonCode: normalized.reasonCode,
          });
        }
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
        if (
          normalized.reasonCode === ReasonCode.OPERATION_ABORTED
          && (this.#state.status === 'closing' || this.#state.status === 'closed')
        ) {
          return;
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
      },
    });
  }

  #emitTelemetry(name: string, data?: JsonObject): void {
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
    const status = checkRuntimeVersionCompatibility({
      version,
      versionChecked: this.#versionChecked,
      sdkRuntimeMajor: SDK_RUNTIME_MAJOR_VERSION,
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
      emitError: (error) => this.#eventBus.emit('error', { error, at: nowIso() }),
      setStatus: (nextStatus) => {
        this.#versionCompatibility = nextStatus;
      },
    });
    this.#versionChecked = status.compatible;
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
