import { createEventBus } from '../internal/event-bus.js';
import type { JsonObject } from '../internal/utils.js';
import { createScopeModule, type ScopeModule } from '../scope/index.js';
import { ReasonCode, type VersionCompatibilityStatus } from '../types/index.js';
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
  RuntimeExternalAgentClient,
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
} from './runtime-method-lookup.js';
import { SDK_RUNTIME_MAJOR_VERSION } from './runtime-defaults.js';
import {
  normalizeText,
  nowIso,
  toIsoFromTimestamp,
} from './runtime-value-utils.js';
import { resolveHealthStatus } from './runtime-health-codec.js';
import type { RuntimeAvatarDebugModule } from './runtime-avatar-debug.js';
import type { RuntimeCompanionParticipationModule } from './runtime-companion-participation.js';
import type { RuntimeArtifactsModule } from './runtime-artifacts.js';
import type { RuntimeAppLifecycleModule } from './runtime-app-lifecycle.js';
import {
  ensureRuntimeClientForCall,
  resolveReadyTimeout,
  waitForRuntimeReady,
} from './runtime-infra.js';
import {
  assertRuntimeMethodAvailable,
  checkRuntimeVersionCompatibility,
  wrapModeDStream,
} from './runtime-guards.js';
import { closeRuntime, connectRuntime, readyRuntime } from './runtime-lifecycle.js';
import {
  runtimeGenerateConvenience,
  runtimeStreamConvenience,
  type RuntimeGenerateInput,
  type RuntimeGenerateResult,
  type RuntimeStreamChunk,
  type RuntimeStreamInput,
} from './runtime-convenience.js';
import { resolveRuntimeConstructorOptions } from './runtime-constructor-options.js';
import { invokeRuntimeWithStateTransitions } from './runtime-invoke-state.js';
import { createRuntimeSurfaceWiring } from './runtime-surface-wiring.js';

export class Runtime {
  readonly appId: string;
  readonly auth: RuntimeAuthClient;
  readonly externalAgent: RuntimeExternalAgentClient;
  readonly appAuth: RuntimeAppAuthClient;
  readonly account: RuntimeAccountClient;
  readonly ai: RuntimeAiModule;
  readonly artifacts: RuntimeArtifactsModule;
  readonly media: RuntimeMediaModule;
  readonly workflow: RuntimeWorkflowClient;
  readonly model: RuntimeModelClient;
  readonly local: RuntimeLocalServiceClient;
  readonly connector: RuntimeConnectorClient;
  readonly knowledge: RuntimeKnowledgeClient;
  readonly memory: RuntimeMemoryClient;
  readonly agent: RuntimeAgentModule;
  readonly avatarDebug: RuntimeAvatarDebugModule;
  readonly companionParticipation: RuntimeCompanionParticipationModule;
  readonly app: {
    sendMessage: RuntimeClient['app']['sendAppMessage'];
    subscribeMessages: RuntimeClient['app']['subscribeAppMessages'];
  };
  readonly appLifecycle: RuntimeAppLifecycleModule;
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
    const constructorOptions = resolveRuntimeConstructorOptions({
      options,
      responseMetadataObserver: (metadata) => {
        const version = metadata['x-nimi-runtime-version'];
        if (version && !this.#runtimeVersion) {
          this.#runtimeVersion = version;
          this.#emitTelemetry('runtime.version.detected', { version });
          this.#checkVersionCompatibility(version);
        }
      },
    });
    this.appId = constructorOptions.appId;
    this.transport = constructorOptions.transport;
    this.#options = constructorOptions.options;

    this.#scopeModule = createScopeModule({ appId: this.appId });

    const surface = createRuntimeSurfaceWiring({
      appId: this.appId,
      options: this.#options,
      transport: this.transport,
      scopeModule: this.#scopeModule,
      eventBus: this.#eventBus,
      invoke: (operation) => this.#invoke(operation),
      invokeWithClient: (operation) => this.#invokeWithClient(operation),
      assertMethodAvailable: (moduleKey, methodKey) => this.#assertMethodAvailable(moduleKey, methodKey),
      wrapModeDStream: (source) => this.#wrapModeDStream(source),
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
    });

    this.#ctx = surface.ctx;
    this.events = surface.events;
    this.auth = surface.auth;
    this.externalAgent = surface.externalAgent;
    this.account = surface.account;
    this.workflow = surface.workflow;
    this.model = surface.model;
    this.local = surface.local;
    this.connector = surface.connector;
    this.knowledge = surface.knowledge;
    this.memory = surface.memory;
    this.audit = surface.audit;
    this.healthEvents = surface.healthEvents;
    this.providerHealthEvents = surface.providerHealthEvents;
    this.app = surface.app;
    this.appAuth = surface.appAuth;
    this.agent = surface.agent;
    this.avatarDebug = surface.avatarDebug;
    this.companionParticipation = surface.companionParticipation;
    this.scope = surface.scope;
    this.ai = surface.ai;
    this.artifacts = surface.artifacts;
    this.appLifecycle = surface.appLifecycle;
    this.media = surface.media;
    this.unsafeRaw = surface.unsafeRaw;
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
    return invokeRuntimeWithStateTransitions({
      operation,
      options: this.#options,
      getState: () => this.#state,
      setState: (state) => {
        this.#state = state;
      },
      clearClient: () => {
        this.#client = null;
      },
      getRetryTransitionEpoch: () => this.#retryTransitionEpoch,
      nextRetryTransitionEpoch: () => {
        this.#retryTransitionEpoch += 1;
        return this.#retryTransitionEpoch;
      },
      emitConnected: (event) => this.#eventBus.emit('runtime.connected', event),
      emitDisconnected: (event) => this.#eventBus.emit('runtime.disconnected', event),
      emitError: (event) => this.#eventBus.emit('error', event),
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
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
