import { CoreClient, type CoreClientOptions, type CoreTransport } from '../core-client';
import { RuntimeHealthStatus } from '../core-generated/runtime-protobuf/runtime/v1/audit';
import { RuntimeTypedClient } from '../core-generated/runtime-typed-client';
import type {
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import type {
  CoreMetadata,
  CoreResponseMetadata,
  CoreResponseMetadataObserver,
  CoreStreamRequest,
  CoreUnaryRequest,
} from '../types';
import { createNimiRuntimeAppLifecycleClient, type NimiRuntimeAppLifecycleClient } from './app-lifecycle';
import { createRuntimeElectronIpcTransport, type RuntimeElectronIpcTransportOptions } from './electron-ipc';
import {
  RUNTIME_ACCOUNT_METHODS,
  RUNTIME_AGENT_METHODS,
  RUNTIME_AI_METHODS,
  RUNTIME_APP_LIFECYCLE_METHODS,
  RUNTIME_APP_LIFECYCLE_METHOD_SET,
  RUNTIME_APP_MESSAGE_METHODS,
  RUNTIME_ARTIFACT_METHODS,
  RUNTIME_AUDIT_METHODS,
  RUNTIME_AUTH_METHODS,
  RUNTIME_CONNECTOR_METHODS,
  RUNTIME_EXTERNAL_AGENT_METHODS,
  RUNTIME_GRANT_METHODS,
  RUNTIME_KNOWLEDGE_METHODS,
  RUNTIME_LOCAL_METHODS,
  RUNTIME_MEMORY_METHODS,
  RUNTIME_REALTIME_METHODS,
  RUNTIME_SCHEDULING_METHODS,
  type NimiRuntimeAppLifecycleGeneratedModule,
  type RuntimeAccountModule,
  type RuntimeAgentModule,
  type RuntimeAiModule,
  type RuntimeAppMessageModule,
  type RuntimeArtifactModule,
  type RuntimeAuditModule,
  type RuntimeAuthModule,
  type RuntimeConnectorModule,
  type RuntimeExternalAgentModule,
  type RuntimeGrantModule,
  type RuntimeKnowledgeModule,
  type RuntimeLocalModule,
  type RuntimeMemoryModule,
  type RuntimeMethodModule,
  type RuntimeRealtimeModule,
  type RuntimeSchedulingModule,
  type RuntimeTypedMethodName,
} from './runtime-method-modules';
import type { RuntimeNodeGrpcTransportOptions } from './node-grpc';
import { createRuntimeTauriIpcTransport, type RuntimeTauriIpcTransportOptions } from './tauri-ipc';

export type { CoreTransport, CoreClientOptions };
export {
  RUNTIME_ACCOUNT_METHODS,
  RUNTIME_AGENT_METHODS,
  RUNTIME_AI_METHODS,
  RUNTIME_APP_LIFECYCLE_METHODS,
  RUNTIME_APP_MESSAGE_METHODS,
  RUNTIME_ARTIFACT_METHODS,
  RUNTIME_AUDIT_METHODS,
  RUNTIME_AUTH_METHODS,
  RUNTIME_CONNECTOR_METHODS,
  RUNTIME_EXTERNAL_AGENT_METHODS,
  RUNTIME_GRANT_METHODS,
  RUNTIME_KNOWLEDGE_METHODS,
  RUNTIME_LOCAL_METHODS,
  RUNTIME_MEMORY_METHODS,
  RUNTIME_REALTIME_METHODS,
  RUNTIME_SCHEDULING_METHODS,
} from './runtime-method-modules';
export type {
  NimiRuntimeAppLifecycleGeneratedModule,
  RuntimeAccountModule,
  RuntimeAgentModule,
  RuntimeAiModule,
  RuntimeAppMessageModule,
  RuntimeArtifactModule,
  RuntimeAuditModule,
  RuntimeAuthModule,
  RuntimeConnectorModule,
  RuntimeExternalAgentModule,
  RuntimeGrantModule,
  RuntimeKnowledgeModule,
  RuntimeLocalModule,
  RuntimeMemoryModule,
  RuntimeMethodModule,
  RuntimeRealtimeModule,
  RuntimeSchedulingModule,
  RuntimeTypedMethodName,
} from './runtime-method-modules';
export type {
  RuntimeDurableCloudTargetRef,
  RuntimeDurableLocalTargetRef,
  RuntimeDurableTargetRef,
} from '../core-generated/runtime-typed-client';
export {
  createRuntimeElectronIpcTransport,
  RuntimeElectronIpcTransportError,
} from './electron-ipc';
export type {
  RuntimeElectronIpcTransportOptions,
} from './electron-ipc';
export {
  createRuntimeTauriIpcTransport,
  RuntimeTauriIpcTransportError,
} from './tauri-ipc';
export type {
  RuntimeTauriIpcTransportOptions,
} from './tauri-ipc';
export * from './account-caller';
export * from './app-lifecycle';
export * from './app-storage';
export * from './app-session';
export * from './agent-local-identity';
export * from './audit-projections';
export * from './runtime-avatar-configuration';
export * from './bridge-config';
export * from './connector-auth-acquisition';
export * from './connector-inventory';
export * from './config-projections';
export * from './external-agent';
export * from './first-run-materialization';
export * from './health-coordinator';
export * from './local-asset-vocabulary';
export * from './runtime-local-model-center';
export * from './runtime-local-profile-manifest';
export * from './runtime-local-recommendation';
export * from './runtime-local-assets';
export * from './memory-embedding-types';
export * from './memory-embedding-projection';
export * from './memory-embedding-surfaces';
export * from './model-catalog';
export * from './product-control-types';
export * from './product-control-projection';
export * from './product-control-client';
export * from './reason-messages';
export * from './route-capability-runtime';
export * from './route-capability-projection';
export * from './route-host-access';
export * from './route-host-codecs';
export * from './route-host-options';
export * from './route-host-projection';
export * from './route-options';
export * from './runtime-agent-values';
export * from './runtime-agent-client';
export * from './runtime-agent-consume-types';
export * from './runtime-agent-consume-projection';
export * from './runtime-agent-consume-client';
export * from './runtime-agent-consumer-helpers';
export * from './runtime-agent-message-action';
export * from './runtime-agent-turn-runner';
export * from './runtime-agent-turns';
export * from './runtime-agent-protected';
export * from './runtime-agent-memory';
export * from './runtime-agent-memory-export';
export * from './runtime-agent-presentation';
export * from './runtime-agent-lifecycle';
export * from './runtime-agent-delegated';
export * from './runtime-agent-participation';
export * from './runtime-agent-group-message';
export * from './runtime-agent-inspect';
export * from './runtime-agent-smoke-verification';
export * from './scenario-jobs';
export * from './speech';

export class RuntimeCore {
  constructor(private readonly client: CoreClient) {}

  unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
    return this.client.unary<Response, Body>(request);
  }

  serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
    return this.client.serverStream<Response, Body>(request);
  }
}

export type RuntimeTransportConfig =
  | CoreTransport
  | (RuntimeNodeGrpcTransportOptions & { readonly type?: 'node-grpc' })
  | (RuntimeTauriIpcTransportOptions & { readonly type: 'tauri-ipc' })
  | (RuntimeElectronIpcTransportOptions & { readonly type: 'electron-ipc' });

export interface RuntimeOptions extends Omit<CoreClientOptions, 'transport'> {
  readonly appId?: string;
  readonly metadata?: CoreMetadata;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
  readonly transport?: RuntimeTransportConfig;
}

type RuntimeNodeGrpcModule = typeof import('./node-grpc');

let runtimeNodeGrpcModulePromise: Promise<RuntimeNodeGrpcModule> | undefined;

function loadRuntimeNodeGrpcModule(): Promise<RuntimeNodeGrpcModule> {
  if (!runtimeNodeGrpcModulePromise) {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<RuntimeNodeGrpcModule>;
    runtimeNodeGrpcModulePromise = dynamicImport('./node-grpc.js');
  }
  return runtimeNodeGrpcModulePromise;
}

function createDeferredRuntimeNodeGrpcTransport(
  options: RuntimeNodeGrpcTransportOptions = {},
): CoreTransport {
  let transportPromise: Promise<CoreTransport> | undefined;
  const ensureTransport = async (): Promise<CoreTransport> => {
    transportPromise ??= loadRuntimeNodeGrpcModule()
      .then((module) => module.createRuntimeNodeGrpcTransport(options));
    return transportPromise;
  };
  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      return (await ensureTransport()).unary<Response, Body>(request);
    },
    async *serverStream<Response = unknown, Body = unknown>(
      request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      yield* (await ensureTransport()).serverStream<Response, Body>(request);
    },
  };
}

export interface RuntimeReadyOptions extends RuntimeTypedCallOptions {
  readonly request?: GetRuntimeHealthRequest;
}

export type RuntimeVersionCompatibilityState = 'unknown' | 'compatible' | 'incompatible';

export interface RuntimeVersionCompatibilityStatus {
  readonly state: RuntimeVersionCompatibilityState;
  readonly compatible: boolean;
  readonly checked: boolean;
  readonly sdkRuntimeMajor: number;
  readonly runtimeVersion: string | null;
  readonly runtimeMajor: number | null;
  readonly reason?: 'metadata_missing' | 'runtime_version_unparseable' | 'major_mismatch';
}

const SDK_RUNTIME_MAJOR_VERSION = 0;

const UNKNOWN_RUNTIME_VERSION_COMPATIBILITY: RuntimeVersionCompatibilityStatus = {
  state: 'unknown',
  compatible: true,
  checked: false,
  sdkRuntimeMajor: SDK_RUNTIME_MAJOR_VERSION,
  runtimeVersion: null,
  runtimeMajor: null,
  reason: 'metadata_missing',
};

export class NimiRuntimeUnavailableError extends Error {
  readonly code = 'RUNTIME_UNAVAILABLE';
  readonly health: GetRuntimeHealthResponse;

  constructor(health: GetRuntimeHealthResponse) {
    super(`Runtime is not ready: ${runtimeHealthStatusLabel(health.status)}`);
    this.name = 'NimiRuntimeUnavailableError';
    this.health = health;
  }
}

export class Runtime {
  readonly core: CoreClient;
  readonly generated: RuntimeTypedClient;
  readonly account: RuntimeAccountModule;
  readonly agents: RuntimeAgentModule;
  readonly ai: RuntimeAiModule;
  readonly scheduling: RuntimeSchedulingModule;
  readonly realtime: RuntimeRealtimeModule;
  readonly connectors: RuntimeConnectorModule;
  readonly auth: RuntimeAuthModule;
  readonly grants: RuntimeGrantModule;
  readonly externalAgents: RuntimeExternalAgentModule;
  readonly audit: RuntimeAuditModule;
  readonly knowledge: RuntimeKnowledgeModule;
  readonly memory: RuntimeMemoryModule;
  readonly local: RuntimeLocalModule;
  readonly appMessages: RuntimeAppMessageModule;
  readonly appLifecycle: NimiRuntimeAppLifecycleClient;
  readonly artifacts: RuntimeArtifactModule;
  #runtimeVersion: string | null = null;
  #versionCompatibility: RuntimeVersionCompatibilityStatus = UNKNOWN_RUNTIME_VERSION_COMPATIBILITY;

  constructor(options: RuntimeOptions | CoreClient | RuntimeTypedClient = {}) {
    this.core = toCoreClient(options, (metadata) => this.#observeResponseMetadata(metadata));
    const generated = options instanceof RuntimeTypedClient
      ? options
      : new RuntimeTypedClient(this.core);
    this.generated = createPublicRuntimeGeneratedClient(generated);
    this.account = bindRuntimeModule(generated, RUNTIME_ACCOUNT_METHODS);
    this.agents = bindRuntimeModule(generated, RUNTIME_AGENT_METHODS);
    this.ai = bindRuntimeModule(generated, RUNTIME_AI_METHODS);
    this.scheduling = bindRuntimeModule(generated, RUNTIME_SCHEDULING_METHODS);
    this.realtime = bindRuntimeModule(generated, RUNTIME_REALTIME_METHODS);
    this.connectors = bindRuntimeModule(generated, RUNTIME_CONNECTOR_METHODS);
    this.auth = bindRuntimeModule(generated, RUNTIME_AUTH_METHODS);
    this.grants = bindRuntimeModule(generated, RUNTIME_GRANT_METHODS);
    this.externalAgents = bindRuntimeModule(generated, RUNTIME_EXTERNAL_AGENT_METHODS);
    this.audit = bindRuntimeModule(generated, RUNTIME_AUDIT_METHODS);
    this.knowledge = bindRuntimeModule(generated, RUNTIME_KNOWLEDGE_METHODS);
    this.memory = bindRuntimeModule(generated, RUNTIME_MEMORY_METHODS);
    this.local = bindRuntimeModule(generated, RUNTIME_LOCAL_METHODS);
    this.appMessages = bindRuntimeModule(generated, RUNTIME_APP_MESSAGE_METHODS);
    this.appLifecycle = createNimiRuntimeAppLifecycleClient({
      client: bindRuntimeModule(generated, RUNTIME_APP_LIFECYCLE_METHODS),
    });
    this.artifacts = bindRuntimeModule(generated, RUNTIME_ARTIFACT_METHODS);
  }

  health(request: GetRuntimeHealthRequest = {}, options: RuntimeTypedCallOptions = {}): Promise<GetRuntimeHealthResponse> {
    return this.audit.getRuntimeHealth(request, options);
  }

  async ready(options: RuntimeReadyOptions = {}): Promise<GetRuntimeHealthResponse> {
    const { request, ...callOptions } = options;
    const health = await this.health(request ?? {}, callOptions);
    if (health.status !== RuntimeHealthStatus.READY) {
      throw new NimiRuntimeUnavailableError(health);
    }
    return health;
  }

  unsafeRawTransport(): CoreTransport {
    return this.core.unsafeRaw();
  }

  runtimeVersion(): string | null {
    return this.#runtimeVersion;
  }

  versionCompatibility(): RuntimeVersionCompatibilityStatus {
    return { ...this.#versionCompatibility };
  }

  #observeResponseMetadata(metadata: CoreResponseMetadata): void {
    const runtimeVersion = normalizeText(metadata['x-nimi-runtime-version']);
    if (!runtimeVersion) {
      return;
    }
    const shouldCheck = runtimeVersion !== this.#runtimeVersion || !this.#versionCompatibility.checked;
    this.#runtimeVersion = runtimeVersion;
    if (shouldCheck) {
      this.#checkVersionCompatibility(runtimeVersion);
    }
  }

  #checkVersionCompatibility(runtimeVersion: string): void {
    const runtimeMajor = parseSemverMajor(runtimeVersion);
    const baseStatus: RuntimeVersionCompatibilityStatus = {
      state: 'incompatible',
      compatible: false,
      checked: true,
      sdkRuntimeMajor: SDK_RUNTIME_MAJOR_VERSION,
      runtimeVersion,
      runtimeMajor,
    };

    if (runtimeMajor === null) {
      this.#versionCompatibility = {
        ...baseStatus,
        reason: 'runtime_version_unparseable',
      };
      throw createNimiError({
        message: `runtime version is unparseable: ${runtimeVersion}`,
        reasonCode: ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE,
        actionHint: 'check_runtime_version_format',
        source: 'sdk',
      });
    }

    if (runtimeMajor !== SDK_RUNTIME_MAJOR_VERSION) {
      this.#versionCompatibility = {
        ...baseStatus,
        reason: 'major_mismatch',
      };
      throw createNimiError({
        message: `runtime major version ${runtimeMajor} is incompatible with SDK Runtime major version ${SDK_RUNTIME_MAJOR_VERSION}`,
        reasonCode: ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE,
        actionHint: 'upgrade_sdk_or_runtime',
        source: 'sdk',
      });
    }

    this.#versionCompatibility = {
      state: 'compatible',
      compatible: true,
      checked: true,
      sdkRuntimeMajor: SDK_RUNTIME_MAJOR_VERSION,
      runtimeVersion,
      runtimeMajor,
    };
  }
}

export function createRuntime(options: RuntimeOptions | CoreClient | RuntimeTypedClient = {}): Runtime {
  return new Runtime(options);
}

function toCoreClient(
  options: RuntimeOptions | CoreClient | RuntimeTypedClient,
  responseMetadataObserver: CoreResponseMetadataObserver,
): CoreClient {
  if (options instanceof CoreClient) {
    return options;
  }
  if (options instanceof RuntimeTypedClient) {
    return extractCoreClient(options);
  }
  return new CoreClient(toCoreClientOptions(options, responseMetadataObserver));
}

function extractCoreClient(client: RuntimeTypedClient): CoreClient {
  const candidate = client as unknown as { readonly core?: unknown };
  if (candidate.core instanceof CoreClient) {
    return candidate.core;
  }
  throw new Error('RuntimeTypedClient was not constructed with the public CoreClient implementation');
}

function bindRuntimeModule<const Keys extends readonly RuntimeTypedMethodName[]>(
  client: RuntimeTypedClient,
  keys: Keys,
): RuntimeMethodModule<Keys> {
  const module: Partial<Record<RuntimeTypedMethodName, unknown>> = {};
  for (const key of keys) {
    const method = client[key];
    if (typeof method !== 'function') {
      throw new Error(`Runtime generated client is missing typed method: ${key}`);
    }
    module[key] = method.bind(client);
  }
  return module as RuntimeMethodModule<Keys>;
}

function createPublicRuntimeGeneratedClient(client: RuntimeTypedClient): RuntimeTypedClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (typeof property === 'string' && RUNTIME_APP_LIFECYCLE_METHOD_SET.has(property)) {
        return async () => {
          throw createNimiError({
            message: `Runtime App lifecycle operation ${property} must run through NimiRuntimeAppLifecycleClient.`,
            reasonCode: 'SDK_RUNTIME_APP_LIFECYCLE_TYPED_CLIENT_REQUIRED',
            actionHint: 'use_runtime_app_lifecycle_client',
            source: 'sdk',
          });
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function toCoreClientOptions(
  options: RuntimeOptions,
  responseMetadataObserver: CoreResponseMetadataObserver,
): CoreClientOptions {
  const includeDefaultIdentity = !(
    options.transport && !isCoreTransportLike(options.transport) && options.transport.type === 'electron-ipc'
  );
  return {
    authMetadata: async () => ({
      ...runtimeDefaultMetadata(options, { includeIdentity: includeDefaultIdentity }),
      ...(options.metadata ?? {}),
      ...(options.authMetadata ? await options.authMetadata() : {}),
    }),
    responseMetadataObserver: combineResponseMetadataObservers(
      responseMetadataObserver,
      options.responseMetadataObserver,
    ),
    transport: toCoreTransport(options.transport),
  };
}

function toCoreTransport(transport: RuntimeOptions['transport']): CoreTransport {
  if (!transport) {
    if (isNodeRuntime()) {
      return createDeferredRuntimeNodeGrpcTransport({
        endpoint: process.env.NIMI_RUNTIME_ENDPOINT,
      });
    }
    throw Object.assign(new Error('Runtime requires an explicit transport outside Node.js'), {
      code: 'SDK_CORE_TRANSPORT_REQUIRED',
    });
  }
  if (isCoreTransportLike(transport)) {
    return transport;
  }
  if (transport.type === 'tauri-ipc') {
    return createRuntimeTauriIpcTransport(transport);
  }
  if (transport.type === 'electron-ipc') {
    return createRuntimeElectronIpcTransport(transport);
  }
  return createDeferredRuntimeNodeGrpcTransport(transport);
}

function runtimeDefaultMetadata(
  options: RuntimeOptions,
  input: { readonly includeIdentity: boolean } = { includeIdentity: true },
): CoreMetadata {
  const appId = resolveRuntimeAppId(options);
  const metadata: CoreMetadata = {
    protocolVersion: '1.0.0',
    participantProtocolVersion: '1.0.0',
    domain: 'runtime.rpc',
  };
  return input.includeIdentity
    ? { ...metadata, participantId: appId, appId, callerKind: 'third-party-app', callerId: appId }
    : metadata;
}

function resolveRuntimeAppId(options: RuntimeOptions): string {
  if (Object.prototype.hasOwnProperty.call(options, 'appId')) {
    const explicitAppId = normalizeText(options.appId);
    if (!explicitAppId) {
      throw Object.assign(new Error('Runtime appId is required when appId is provided'), {
        code: 'SDK_APP_ID_REQUIRED',
      });
    }
    return explicitAppId;
  }
  return normalizeText(isNodeRuntime() ? process.env.NIMI_APP_ID : undefined) || 'nimi.app';
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function parseSemverMajor(version: string): number | null {
  const majorText = normalizeText(version).match(/^(\d+)(?:\.|$)/)?.[1];
  if (!majorText) {
    return null;
  }
  const major = Number.parseInt(majorText, 10);
  return Number.isFinite(major) ? major : null;
}

function combineResponseMetadataObservers(
  first: CoreResponseMetadataObserver | undefined,
  second: CoreResponseMetadataObserver | undefined,
): CoreResponseMetadataObserver | undefined {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return (metadata) => {
    first(metadata);
    second(metadata);
  };
}

function isCoreTransportLike(value: unknown): value is CoreTransport {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  return typeof candidate.unary === 'function' && typeof candidate.serverStream === 'function';
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

function runtimeHealthStatusLabel(status: GetRuntimeHealthResponse['status'] | undefined): string {
  if (typeof status === 'number') {
    return RuntimeHealthStatus[status] ?? String(status);
  }
  return String(status ?? RuntimeHealthStatus.UNSPECIFIED);
}
