import { CoreClient, type CoreClientOptions, type CoreTransport } from '../core-client';
import { RUNTIME_METHODS } from '../core-generated/runtime-client';
import { RuntimeHealthStatus } from '../core-generated/runtime-protobuf/runtime/v1/audit';
import {
  runtimeRpcAuthPosture,
  type RuntimeRpcAuthPosture,
} from '../core-generated/runtime-rpc-auth-posture';
import {
  RealmSourceMaterializationReasonCode,
  RuntimeTypedClient,
} from '../core-generated/runtime-typed-client';
import type {
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
  MaterializeRealmSourceResponse,
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
import { createRuntimeElectronIpcTransport, type RuntimeElectronIpcTransportOptions } from './electron-ipc';
import {
  RUNTIME_ACCOUNT_METHODS,
  RUNTIME_AGENT_METHODS,
  RUNTIME_AI_METHODS,
  RUNTIME_APP_MESSAGE_METHODS,
  RUNTIME_ARTIFACT_METHODS,
  RUNTIME_AUDIT_METHODS,
  RUNTIME_AUTH_METHODS,
  RUNTIME_CONNECTOR_METHODS,
  RUNTIME_EXTERNAL_AGENT_METHODS,
  RUNTIME_KNOWLEDGE_METHODS,
  RUNTIME_LOCAL_METHODS,
  RUNTIME_MEMORY_METHODS,
  RUNTIME_REALTIME_METHODS,
  RUNTIME_ROOT_AGENT_FACADE_METHODS,
  RUNTIME_SCHEDULING_METHODS,
  type RuntimeAccountModule,
  type RuntimeAgentModule,
  type RuntimeAiModule,
  type RuntimeAppMessageModule,
  type RuntimeArtifactModule,
  type RuntimeAuditModule,
  type RuntimeAuthModule,
  type RuntimeConnectorModule,
  type RuntimeExternalAgentModule,
  type RuntimeKnowledgeModule,
  type RuntimeLocalModule,
  type RuntimeMemoryModule,
  type RuntimeMethodModule,
  type RuntimeRealtimeModule,
  type RuntimeRootAgentFacadeMethodName,
  type RuntimeSchedulingModule,
  type RuntimeTypedMethodName,
} from './runtime-method-modules';
import type { RuntimeNodeGrpcTransportOptions } from './node-grpc';
import type { NimiRuntimeAgentSourceRef } from './runtime-agent-context-projections';
import {
  NIMI_FIRST_PARTY_PROTECTED_RUNTIME_TYPED_METHOD_GROUPS,
  type DesktopMachineProductRuntimeMethods,
} from './first-party-protected-runtime-profiles.generated.js';
import {
  strictMaterializationRecord,
  strictMaterializationRequestId,
  toRuntimeCharacterSourceRefV3,
} from './runtime-materialization-input';
import { isRuntimeLocalAgentRef } from './agent-local-identity';
import { resolveNimiRuntimeAgentSubjectUserId } from './runtime-agent-protected';
import { createRuntimeTauriIpcTransport, type RuntimeTauriIpcTransportOptions } from './tauri-ipc';

export type { CoreTransport, CoreClientOptions };
export {
  RUNTIME_ACCOUNT_METHODS,
  RUNTIME_AGENT_METHODS,
  RUNTIME_AI_METHODS,
  RUNTIME_APP_MESSAGE_METHODS,
  RUNTIME_ARTIFACT_METHODS,
  RUNTIME_AUDIT_METHODS,
  RUNTIME_AUTH_METHODS,
  RUNTIME_CONNECTOR_METHODS,
  RUNTIME_EXTERNAL_AGENT_METHODS,
  RUNTIME_KNOWLEDGE_METHODS,
  RUNTIME_LOCAL_METHODS,
  RUNTIME_MEMORY_METHODS,
  RUNTIME_REALTIME_METHODS,
  RUNTIME_ROOT_AGENT_FACADE_METHODS,
  RUNTIME_SCHEDULING_METHODS,
} from './runtime-method-modules';
export type {
  RuntimeAccountModule,
  RuntimeAgentModule,
  RuntimeAiModule,
  RuntimeAppMessageModule,
  RuntimeArtifactModule,
  RuntimeAuditModule,
  RuntimeAuthModule,
  RuntimeConnectorModule,
  RuntimeExternalAgentModule,
  RuntimeKnowledgeModule,
  RuntimeLocalModule,
  RuntimeMemoryModule,
  RuntimeMethodModule,
  RuntimeRealtimeModule,
  RuntimeRootAgentFacadeMethodName,
  RuntimeSchedulingModule,
  RuntimeTypedMethodName,
} from './runtime-method-modules';
export type {
  RuntimeTypedCallOptions,
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
export * from './bundled-avatar-runtime';
export * from './desktop-first-party-runtime';
export * from './app-session';
export * from './agent-local-identity';
export * from './audit-projections';
export * from './desktop-audit';
export * from './bridge-config';
export * from './connector-auth-acquisition';
export * from './connector-inventory';
export * from './config-projections';
export * from './external-agent';
export * from './first-run-materialization';
export * from './health-coordinator';
export * from './local-asset-vocabulary';
export * from './machine-local-ai-configuration.js';
export * from './runtime-local-model-center';
export * from './runtime-local-profile-manifest';
export * from './runtime-local-recommendation';
export * from './runtime-local-assets';
export * from './model-catalog';
export * from './platform-client';
export * from './proposal-intake';
export * from './product-control-types';
export * from './product-control-projection';
export * from './product-control-client';
export * from './reason-messages';
export * from './runtime-agent-values';
export * from './runtime-agent-voice';
export * from './runtime-agent-client';
export * from './runtime-agent-context-projections';
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
export * from './runtime-agent-memory-observatory';
export * from './runtime-agent-identity-safety';
export * from './runtime-agent-presentation';
export * from './runtime-agent-lifecycle';
export * from './runtime-agent-delegated';
export * from './shared-local-agent-ai-config';
export * from './runtime-agent-inspect';
export * from './scenario-jobs';
export * from './speech';

export type RuntimeTransportConfig =
  | CoreTransport
  | (RuntimeNodeGrpcTransportOptions & { readonly type?: 'node-grpc' })
  | (RuntimeTauriIpcTransportOptions & { readonly type: 'tauri-ipc' })
  | (RuntimeElectronIpcTransportOptions & { readonly type: 'electron-ipc' });

export interface RuntimeOptions extends Omit<CoreClientOptions, 'transport'> {
  readonly appId?: string;
  readonly getSubjectUserId?: () => string | Promise<string | undefined> | undefined;
  readonly hostOwnedIdentity?: boolean;
  readonly metadata?: CoreMetadata;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
  readonly transport?: RuntimeTransportConfig;
}

export interface RuntimeMaterializeRealmSourceInput {
  readonly sourceRef: NimiRuntimeAgentSourceRef;
  readonly requestId: string;
}

export type RuntimeMaterializeRealmSourceResult = MaterializeRealmSourceResponse;

function runtimeMaterializationReasonCodeName(
  reasonCode: RealmSourceMaterializationReasonCode,
): string {
  const name = RealmSourceMaterializationReasonCode[reasonCode];
  return typeof name === 'string' && name ? name : 'UNSPECIFIED';
}

function runtimeMaterializationFailure(
  response: MaterializeRealmSourceResponse,
): never {
  const reasonName = runtimeMaterializationReasonCodeName(response.reasonCode);
  throw createNimiError({
    message: `Runtime Realm source materialization failed: ${reasonName.toLowerCase().replaceAll('_', ' ')}.`,
    reasonCode: `REALM_SOURCE_MATERIALIZATION_REASON_CODE_${reasonName}`,
    actionHint: 'inspect_realm_source_materialization_failure',
    source: 'runtime',
    details: {
      idempotentReplay: response.idempotentReplay,
    },
  });
}

function requireCommittedRuntimeMaterialization(
  response: MaterializeRealmSourceResponse,
): RuntimeMaterializeRealmSourceResult {
  if (response.reasonCode !== RealmSourceMaterializationReasonCode.NONE) {
    runtimeMaterializationFailure(response);
  }
  if (!isRuntimeLocalAgentRef(response.localAgentRef)) {
    throw createNimiError({
      message: 'Runtime Realm source materialization returned no committed LocalAgent identity.',
      reasonCode: 'REALM_SOURCE_MATERIALIZATION_RESPONSE_INVALID',
      actionHint: 'inspect_realm_source_materialization_response',
      source: 'runtime',
      details: {
        idempotentReplay: response.idempotentReplay,
      },
    });
  }
  return response;
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
  const transportOptions = options;
  let transportPromise: Promise<CoreTransport> | undefined;
  const ensureTransport = async (): Promise<CoreTransport> => {
    transportPromise ??= loadRuntimeNodeGrpcModule()
      .then((module) => module.createRuntimeNodeGrpcTransport(transportOptions));
    return transportPromise;
  };
  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      return (await ensureTransport()).unary<Response, Body>(request);
    },
    serverStream<Response = unknown, Body = unknown>(
      request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      return forwardDeferredRuntimeServerStream(async () => (await ensureTransport()).serverStream<Response, Body>(request));
    },
  };
}

function forwardDeferredRuntimeServerStream<Response>(
  open: () => Promise<AsyncIterable<Response>>,
): AsyncIterable<Response> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Response> {
      let closed = false;
      let source: Promise<AsyncIterable<Response>> | undefined;
      let sourceIterator: AsyncIterator<Response> | undefined;

      const ensureIterator = async (): Promise<AsyncIterator<Response>> => {
        source ??= open();
        const stream = await source;
        sourceIterator ??= stream[Symbol.asyncIterator]();
        return sourceIterator;
      };

      const closeSource = () => {
        const closeIterator = (iterator: AsyncIterator<Response>) => {
          if (typeof iterator.return === 'function') {
            void Promise.resolve(iterator.return()).catch(() => undefined);
          }
        };
        if (sourceIterator) {
          closeIterator(sourceIterator);
          return;
        }
        if (source) {
          void source.then((stream) => {
            sourceIterator ??= stream[Symbol.asyncIterator]();
            closeIterator(sourceIterator);
          }).catch(() => undefined);
        }
      };

      return {
        next: async (): Promise<IteratorResult<Response>> => {
          if (closed) {
            return { done: true, value: undefined };
          }
          try {
            const iterator = await ensureIterator();
            if (closed) {
              return { done: true, value: undefined };
            }
            const result = await iterator.next();
            if (closed) {
              return { done: true, value: undefined };
            }
            return result;
          } catch (error) {
            if (closed) {
              return { done: true, value: undefined };
            }
            throw error;
          }
        },
        return: async (): Promise<IteratorResult<Response>> => {
          if (!closed) {
            closed = true;
            closeSource();
          }
          return { done: true, value: undefined };
        },
      };
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

export type NimiDesktopPermissionOwnerRuntimeClient = Pick<
  RuntimeTypedClient,
  | 'listLocalAppPermissionRequests'
  | 'subscribeLocalAppPermissionRequests'
  | 'getLocalAppPermissionOwnerProjection'
  | 'listLocalAppPermissionOwnerProjections'
  | 'decideLocalAppPermission'
  | 'revokeLocalAppPermission'
>;

export class Runtime {
  readonly #core: CoreClient;
  readonly #appId: string;
  readonly #getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly #materializeRealmSource: RuntimeTypedClient['materializeRealmSource'];
  readonly generated: RuntimePublicGeneratedClient;
  /** Protected Desktop owner plane; present only for host-owned Runtime clients. */
  readonly desktopPermissionOwner?: NimiDesktopPermissionOwnerRuntimeClient;
  /** Exact machine product profile; present only for host-owned Runtime clients. */
  readonly desktopMachineProduct?: DesktopMachineProductRuntimeMethods;
  readonly account: RuntimeAccountModule;
  readonly agents: RuntimeAgentModule;
  readonly ai: RuntimeAiModule;
  readonly scheduling: RuntimeSchedulingModule;
  readonly realtime: RuntimeRealtimeModule;
  readonly connectors: RuntimeConnectorModule;
  readonly auth: RuntimeAuthModule;
  readonly externalAgents: RuntimeExternalAgentModule;
  readonly audit: RuntimeAuditModule;
  readonly knowledge: RuntimeKnowledgeModule;
  readonly memory: RuntimeMemoryModule;
  readonly local: RuntimeLocalModule;
  readonly appMessages: RuntimeAppMessageModule;
  readonly artifacts: RuntimeArtifactModule;
  #runtimeVersion: string | null = null;
  #versionCompatibility: RuntimeVersionCompatibilityStatus = UNKNOWN_RUNTIME_VERSION_COMPATIBILITY;

  constructor(options: RuntimeOptions = {}) {
    this.#appId = resolveRuntimeAppId(options);
    this.#getSubjectUserId = options.getSubjectUserId ?? (() => undefined);
    this.#core = new CoreClient(toCoreClientOptions(
      options,
      (metadata) => this.#observeResponseMetadata(metadata),
    ));
    const generated = new RuntimeTypedClient(this.#core);
    this.#materializeRealmSource = generated.materializeRealmSource.bind(generated);
    this.generated = createPublicRuntimeGeneratedClient(generated);
    if (options.hostOwnedIdentity === true) {
      this.desktopPermissionOwner = bindRuntimeModule(generated, [
        'listLocalAppPermissionRequests',
        'subscribeLocalAppPermissionRequests',
        'getLocalAppPermissionOwnerProjection',
        'listLocalAppPermissionOwnerProjections',
        'decideLocalAppPermission',
        'revokeLocalAppPermission',
      ] as const);
      this.desktopMachineProduct = bindRuntimeModule(
        generated,
        NIMI_FIRST_PARTY_PROTECTED_RUNTIME_TYPED_METHOD_GROUPS.desktop_machine_product_v1,
      );
    }
    this.account = bindRuntimeModule(this.generated, RUNTIME_ACCOUNT_METHODS);
    this.agents = bindRuntimeModule(generated, RUNTIME_AGENT_METHODS);
    this.ai = bindRuntimeModule(generated, RUNTIME_AI_METHODS);
    this.scheduling = bindRuntimeModule(generated, RUNTIME_SCHEDULING_METHODS);
    this.realtime = bindRuntimeModule(generated, RUNTIME_REALTIME_METHODS);
    this.connectors = bindRuntimeModule(generated, RUNTIME_CONNECTOR_METHODS);
    this.auth = bindRuntimeModule(generated, RUNTIME_AUTH_METHODS);
    this.externalAgents = bindRuntimeModule(generated, RUNTIME_EXTERNAL_AGENT_METHODS);
    this.audit = bindRuntimeModule(generated, RUNTIME_AUDIT_METHODS);
    this.knowledge = bindRuntimeModule(generated, RUNTIME_KNOWLEDGE_METHODS);
    this.memory = bindRuntimeModule(generated, RUNTIME_MEMORY_METHODS);
    this.local = bindRuntimeModule(generated, RUNTIME_LOCAL_METHODS);
    this.appMessages = bindRuntimeModule(generated, RUNTIME_APP_MESSAGE_METHODS);
    this.artifacts = bindRuntimeModule(this.generated, RUNTIME_ARTIFACT_METHODS);
  }

  async materializeRealmSource(
    input: RuntimeMaterializeRealmSourceInput,
  ): Promise<RuntimeMaterializeRealmSourceResult> {
    const materializationInput = strictMaterializationRecord(
      input,
      'materializeRealmSource input',
      new Set(['sourceRef', 'requestId']),
    );
    const requestId = strictMaterializationRequestId(materializationInput.requestId);
    const sourceRef = toRuntimeCharacterSourceRefV3(materializationInput.sourceRef);
    const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
      this.#getSubjectUserId,
      'Realm source materialization requires authenticated subject user id.',
    );
    const response = await this.#materializeRealmSource({
      context: {
        appId: this.#appId,
        subjectUserId,
        ownerUserId: subjectUserId,
        runtimeSourceRef: '',
        localAgentRef: '',
      },
      requestId,
      sourceRef,
    });
    return requireCommittedRuntimeMaterialization(response);
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

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  return new Runtime(options);
}

function bindRuntimeModule<const Keys extends readonly RuntimeTypedMethodName[]>(
  client: Pick<RuntimeTypedClient, Keys[number]>,
  keys: Keys,
): RuntimeMethodModule<Keys> {
  const module: Partial<Record<RuntimeTypedMethodName, unknown>> = {};
  const typedClient = client as RuntimeMethodModule<Keys>;
  for (const key of keys) {
    const typedKey = key as Keys[number];
    const method = typedClient[typedKey];
    if (typeof method !== 'function') {
      throw new Error(`Runtime generated client is missing typed method: ${typedKey}`);
    }
    module[typedKey] = method.bind(client);
  }
  return module as RuntimeMethodModule<Keys>;
}

export type RuntimePublicGeneratedClient = Omit<RuntimeTypedClient, 'materializeRealmSource'>;

function createPublicRuntimeGeneratedClient(
  client: RuntimeTypedClient,
): RuntimePublicGeneratedClient {
  const publicClient = Object.create(null) as Record<string, unknown>;
  for (const property of Object.getOwnPropertyNames(RuntimeTypedClient.prototype)) {
    if (property === 'constructor') {
      continue;
    }
    if (property === 'materializeRealmSource') {
      continue;
    }
    if (RUNTIME_PUBLIC_GENERATED_BLOCKED_METHODS.has(property)) {
      publicClient[property] = async () => {
        throw createNimiError({
          message: `Runtime protected method ${property} is unavailable on the public generated client.`,
          reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
          actionHint: 'use_admitted_protected_runtime_carrier',
          source: 'sdk',
        });
      };
      continue;
    }
    const value = client[property as RuntimeTypedMethodName];
    if (typeof value === 'function') {
      publicClient[property] = value.bind(client);
    }
  }
  return Object.freeze(publicClient) as unknown as RuntimePublicGeneratedClient;
}

const RUNTIME_PUBLIC_GENERATED_BLOCKED_POSTURES = new Set<RuntimeRpcAuthPosture>([
  'protected_origin_required',
  'blocked_pending_authority',
]);

const RUNTIME_PUBLIC_GENERATED_BLOCKED_METHODS = new Set(
  RUNTIME_METHODS
    .filter(({ methodId }) => {
      const posture = runtimeRpcAuthPosture(methodId);
      return posture !== null && RUNTIME_PUBLIC_GENERATED_BLOCKED_POSTURES.has(posture);
    })
    .map(({ method }) => `${method.slice(0, 1).toLowerCase()}${method.slice(1)}`),
);

function toCoreClientOptions(
  options: RuntimeOptions,
  responseMetadataObserver: CoreResponseMetadataObserver,
): CoreClientOptions {
  const includeDefaultIdentity = !(
    options.hostOwnedIdentity === true
    || (options.transport && !isCoreTransportLike(options.transport)
      && (options.transport.type === 'electron-ipc' || options.transport.type === 'tauri-ipc'))
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

function toCoreTransport(
  transport: RuntimeOptions['transport'],
): CoreTransport {
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
