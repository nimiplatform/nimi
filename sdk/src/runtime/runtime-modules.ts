import type { ScopeModule } from '../scope/index.js';
import type { JsonObject } from '../internal/utils.js';
import { normalizeText, nowIso, wrapModeBWorkflowStream } from './helpers.js';
import {
  runtimeGenerateText,
  runtimeStreamText,
  runtimeGenerateEmbedding,
} from './runtime-ai-text.js';
import { FallbackPolicy } from './generated/runtime/v1/ai.js';
import {
  runtimeSubmitScenarioJobForMedia,
  runtimeGetScenarioJobForMedia,
  runtimeCancelScenarioJobForMedia,
  runtimeSubscribeScenarioJobForMedia,
  runtimeGetScenarioArtifactsForMedia,
} from './runtime-media.js';
import {
  runtimeGenerateImage,
  runtimeGenerateVideo,
  runtimeGenerateMusicIteration,
  runtimeGenerateMusic,
  runtimeSynthesizeSpeech,
  runtimeTranscribeSpeech,
  runtimeStreamImage,
  runtimeStreamVideo,
  runtimeStreamSpeech,
  runtimeListSpeechVoices,
} from './runtime-modality.js';
import { runtimeAiRequestRequiresSubject } from './runtime-guards.js';
import type {
  RuntimeAiModule,
  RuntimeAccountClient,
  RuntimeAiExecuteScenarioRequestInput,
  RuntimeAiOpenRealtimeSessionRequestInput,
  RuntimeAiStreamScenarioRequestInput,
  RuntimeAiSubmitScenarioJobRequestInput,
  RuntimeAiUploadArtifactInput,
  RuntimeAppAuthClient,
  RuntimeAgentClient,
  RuntimeAuditClient,
  RuntimeAuthClient,
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeConnectorClient,
  RuntimeEventPayloadMap,
  RuntimeEventsModule,
  RuntimeKnowledgeClient,
  RuntimeLocalServiceClient,
  RuntimeMemoryClient,
  RuntimeMediaModule,
  RuntimeModelClient,
  RuntimeScopeModule,
  RuntimeStreamCallOptions,
  RuntimeUnsafeRawModule,
  RuntimeWorkflowClient,
} from './types.js';
import type { RuntimeInternalContext } from './internal-context.js';

type RuntimeInvokeWithClient = <T>(operation: (client: RuntimeClient) => Promise<T>) => Promise<T>;

type RuntimeInvoke = <T>(operation: () => Promise<T>) => Promise<T>;
type RuntimeAiUploadModule = typeof import('./runtime-ai-upload.js');

type RuntimePassthroughModuleKey =
  'auth'
  | 'account'
  | 'workflow'
  | 'model'
  | 'local'
  | 'connector'
  | 'knowledge'
  | 'memory'
  | 'agent'
  | 'audit';

type RuntimePassthroughClient = Record<string, (request: any, options?: any) => Promise<any>>;

type RuntimePassthroughMethod<TClient extends RuntimePassthroughClient> = Extract<keyof TClient, string>;

type RuntimeRawCall = RuntimeUnsafeRawModule['call'];

type RuntimeModuleAppClient = {
  sendMessage: RuntimeClient['app']['sendAppMessage'];
  subscribeMessages: RuntimeClient['app']['subscribeAppMessages'];
};

type RuntimeAuthEventEmitter = {
  emitTokenIssued: (tokenId: string) => void;
  emitTokenRevoked: (tokenId: string) => void;
};

type RuntimeTelemetryEmitter = (name: string, data?: JsonObject) => void;

let runtimeAiUploadModulePromise: Promise<RuntimeAiUploadModule> | null = null;

function loadRuntimeAiUploadModule(): Promise<RuntimeAiUploadModule> {
  if (!runtimeAiUploadModulePromise) {
    runtimeAiUploadModulePromise = import('./runtime-ai-upload.js');
  }
  return runtimeAiUploadModulePromise;
}

export type RuntimeCorePassthroughClients = {
  auth: RuntimeAuthClient;
  account: RuntimeAccountClient;
  workflow: RuntimeWorkflowClient;
  model: RuntimeModelClient;
  local: RuntimeLocalServiceClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  memory: RuntimeMemoryClient;
  agent: RuntimeAgentClient;
  audit: RuntimeAuditClient;
};

const AUTH_METHODS = [
  'registerApp',
  'openSession',
  'refreshSession',
  'revokeSession',
  'registerExternalPrincipal',
  'openExternalPrincipalSession',
  'revokeExternalPrincipalSession',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeAuthClient>[];

const ACCOUNT_METHODS = [
  'getAccountSessionStatus',
  'beginLogin',
  'completeLogin',
  'getAccessToken',
  'refreshAccountSession',
  'logout',
  'switchAccount',
  'issueScopedAppBinding',
  'revokeScopedAppBinding',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeAccountClient>[];

const MODEL_METHODS = [
  'list',
  'pull',
  'remove',
  'checkHealth',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeModelClient>[];

const LOCAL_METHODS = [
  'listLocalAssets',
  'listVerifiedAssets',
  'searchCatalogModels',
  'resolveModelInstallPlan',
  'installVerifiedAsset',
  'importLocalAsset',
  'importLocalAssetFile',
  'scanUnregisteredAssets',
  'scaffoldOrphanAsset',
  'removeLocalAsset',
  'startLocalAsset',
  'stopLocalAsset',
  'checkLocalAssetHealth',
  'warmLocalAsset',
  'listLocalTransfers',
  'pauseLocalTransfer',
  'resumeLocalTransfer',
  'cancelLocalTransfer',
  'collectDeviceProfile',
  'resolveProfile',
  'applyProfile',
  'listLocalServices',
  'installLocalService',
  'startLocalService',
  'stopLocalService',
  'checkLocalServiceHealth',
  'removeLocalService',
  'listNodeCatalog',
  'listLocalAudits',
  'appendInferenceAudit',
  'appendRuntimeAudit',
  'listEngines',
  'ensureEngine',
  'startEngine',
  'stopEngine',
  'getEngineStatus',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeLocalServiceClient>[];

const CONNECTOR_METHODS = [
  'createConnector',
  'getConnector',
  'listConnectors',
  'updateConnector',
  'deleteConnector',
  'testConnector',
  'listConnectorModels',
  'listProviderCatalog',
  'listModelCatalogProviders',
  'listCatalogProviderModels',
  'getCatalogModelDetail',
  'upsertModelCatalogProvider',
  'deleteModelCatalogProvider',
  'upsertCatalogModelOverlay',
  'deleteCatalogModelOverlay',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeConnectorClient>[];

const KNOWLEDGE_METHODS = [
  'createKnowledgeBank',
  'getKnowledgeBank',
  'listKnowledgeBanks',
  'deleteKnowledgeBank',
  'putPage',
  'getPage',
  'listPages',
  'deletePage',
  'searchKeyword',
  'searchHybrid',
  'addLink',
  'removeLink',
  'listLinks',
  'listBacklinks',
  'traverseGraph',
  'ingestDocument',
  'getIngestTask',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeKnowledgeClient>[];

const MEMORY_METHODS = [
  'createBank',
  'getBank',
  'listBanks',
  'deleteBank',
  'retain',
  'recall',
  'history',
  'deleteMemory',
  'subscribeEvents',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeMemoryClient>[];

const AGENT_METHODS = [
  'initializeAgent',
  'terminateAgent',
  'getAgent',
  'listAgents',
  'openConversationAnchor',
  'getConversationAnchorSnapshot',
  'getPublicChatSessionSnapshot',
  'getAgentState',
  'updateAgentState',
  'setPresentationProfile',
  'enableAutonomy',
  'disableAutonomy',
  'setAutonomyConfig',
  'listPendingHooks',
  'cancelHook',
  'queryMemory',
  'writeMemory',
  'subscribeEvents',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeAgentClient>[];

const AUDIT_METHODS = [
  'listAuditEvents',
  'exportAuditEvents',
  'listUsageStats',
  'getRuntimeHealth',
  'listAIProviderHealth',
  'subscribeAIProviderHealthEvents',
  'subscribeRuntimeHealthEvents',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeAuditClient>[];

function createPassthroughModule<
  TModuleKey extends RuntimePassthroughModuleKey,
  TClient extends RuntimePassthroughClient,
  TMethodName extends RuntimePassthroughMethod<TClient>,
>(
  moduleKey: TModuleKey,
  methods: readonly TMethodName[],
  input: {
    guard: (moduleKey: RuntimePassthroughModuleKey, methodKey: string) => void;
    invokeWithClient: RuntimeInvokeWithClient;
  },
): Pick<TClient, TMethodName> {
  const { guard, invokeWithClient } = input;
  const moduleClient = {} as Pick<TClient, TMethodName>;

  for (const methodName of methods) {
    moduleClient[methodName] = (async (request: any, options?: any) => {
      guard(moduleKey, methodName);
      return invokeWithClient(async (client) => {
        const runtimeModule = client[moduleKey] as Record<string, (request: any, options?: any) => Promise<any>>;
        const runtimeMethod = runtimeModule[methodName];
        if (typeof runtimeMethod !== 'function') {
          throw new Error(`runtime passthrough method missing: ${String(moduleKey)}.${String(methodName)}`);
        }
        return runtimeMethod(request, options);
      });
    }) as Pick<TClient, TMethodName>[TMethodName];
  }

  return moduleClient;
}

export function createRuntimeEventsModule(
  eventBus: {
    on: <K extends keyof RuntimeEventPayloadMap>(name: K, handler: (payload: RuntimeEventPayloadMap[K]) => void) => () => void;
    once: <K extends keyof RuntimeEventPayloadMap>(name: K, handler: (payload: RuntimeEventPayloadMap[K]) => void) => () => void;
  },
): RuntimeEventsModule {
  return {
    on: (name, handler) => eventBus.on(name, handler),
    once: (name, handler) => eventBus.once(name, handler),
  };
}

export function createCorePassthroughClients(input: {
  assertMethodAvailable: (moduleKey: string, methodKey: string) => void;
  invokeWithClient: RuntimeInvokeWithClient;
}): RuntimeCorePassthroughClients {
  const { assertMethodAvailable, invokeWithClient } = input;

  const guard = (mod: RuntimePassthroughModuleKey, method: string) => assertMethodAvailable(mod, method);

  const auth: RuntimeAuthClient = createPassthroughModule('auth', AUTH_METHODS, { guard, invokeWithClient });
  const accountBase = createPassthroughModule('account', ACCOUNT_METHODS, { guard, invokeWithClient });
  const account: RuntimeAccountClient = {
    ...accountBase,
    subscribeAccountSessionEvents: async (request, optionsValue) => {
      guard('account', 'subscribeAccountSessionEvents');
      return invokeWithClient(async (client) => client.account.subscribeAccountSessionEvents(request, optionsValue));
    },
  };

  const workflowBase = createPassthroughModule('workflow', ['submit', 'get', 'cancel'] as const, { guard, invokeWithClient });
  const workflow: RuntimeWorkflowClient = {
    ...workflowBase,
    subscribeEvents: async (req, opts) => {
      guard('workflow', 'subscribeEvents');
      const raw = await invokeWithClient((c) => c.workflow.subscribeEvents(req, opts));
      return wrapModeBWorkflowStream(raw);
    },
  };

  const model: RuntimeModelClient = createPassthroughModule('model', MODEL_METHODS, { guard, invokeWithClient });

  const localBase = createPassthroughModule('local', LOCAL_METHODS, { guard, invokeWithClient });
  const local: RuntimeLocalServiceClient = {
    ...localBase,
    watchLocalTransfers: async (request, optionsValue) => {
      guard('local', 'watchLocalTransfers');
      return invokeWithClient(async (client) => client.local.watchLocalTransfers(request, optionsValue));
    },
  };

  const connector: RuntimeConnectorClient = createPassthroughModule('connector', CONNECTOR_METHODS, { guard, invokeWithClient });

  const knowledge: RuntimeKnowledgeClient = createPassthroughModule('knowledge', KNOWLEDGE_METHODS, { guard, invokeWithClient });

  const memoryBase = createPassthroughModule('memory', MEMORY_METHODS, { guard, invokeWithClient });
  const memory: RuntimeMemoryClient = {
    ...memoryBase,
    subscribeEvents: async (request, optionsValue) => {
      guard('memory', 'subscribeEvents');
      return invokeWithClient(async (client) => client.memory.subscribeEvents(request, optionsValue));
    },
  };

  const agentBase = createPassthroughModule('agent', AGENT_METHODS, { guard, invokeWithClient });
  const agent: RuntimeAgentClient = {
    ...agentBase,
    subscribeEvents: async (request, optionsValue) => {
      guard('agent', 'subscribeEvents');
      return invokeWithClient(async (client) => client.agent.subscribeEvents(request, optionsValue));
    },
  };

  const audit: RuntimeAuditClient = createPassthroughModule('audit', AUDIT_METHODS, { guard, invokeWithClient });

  return { auth, account, workflow, model, local, connector, knowledge, memory, agent, audit };
}

export function createAppClient(input: {
  invokeWithClient: RuntimeInvokeWithClient;
  wrapModeDStream: <T>(source: AsyncIterable<T>) => AsyncIterable<T>;
}): RuntimeModuleAppClient {
  return {
    sendMessage: async (request, options) => input.invokeWithClient(
      async (client) => client.app.sendAppMessage(request, options),
    ),
    subscribeMessages: async (request, options) => {
      const raw = await input.invokeWithClient(
        async (client) => client.app.subscribeAppMessages(request, options),
      );
      return input.wrapModeDStream(raw);
    },
  };
}

export function createAppAuthClient(
  input: {
    invokeWithClient: RuntimeInvokeWithClient;
    resolvePublishedCatalogVersion: (requested?: string) => string;
    emitTelemetry: RuntimeTelemetryEmitter;
    authEvents: RuntimeAuthEventEmitter;
  },
): RuntimeAppAuthClient {
  const {
    invokeWithClient,
    resolvePublishedCatalogVersion,
    emitTelemetry,
    authEvents,
  } = input;

  return {
    authorizeExternalPrincipal: async (request, optionsValue) => {
      const resolvedScopeCatalogVersion = resolvePublishedCatalogVersion(request.scopeCatalogVersion);
      const response = await invokeWithClient(async (client) => client.appAuth.authorizeExternalPrincipal(
        {
          ...request,
          scopeCatalogVersion: resolvedScopeCatalogVersion,
        },
        optionsValue,
      ));

      const issuedScopeCatalogVersion = normalizeText(response.issuedScopeCatalogVersion);
      if (issuedScopeCatalogVersion && issuedScopeCatalogVersion !== resolvedScopeCatalogVersion) {
        emitTelemetry('runtime.app-auth.scope-version-mismatch', {
          requested: resolvedScopeCatalogVersion,
          issued: issuedScopeCatalogVersion,
        });
      }

      const tokenId = normalizeText(response.tokenId);
      if (tokenId) {
        authEvents.emitTokenIssued(tokenId);
      }

      return response;
    },
    validateToken: async (request, optionsValue) => invokeWithClient(
      async (client) => client.appAuth.validateToken(request, optionsValue),
    ),
    revokeToken: async (request, optionsValue) => {
      const response = await invokeWithClient(
        async (client) => client.appAuth.revokeToken(request, optionsValue),
      );
      const tokenId = normalizeText(request.tokenId);
      if (tokenId) {
        authEvents.emitTokenRevoked(tokenId);
      }
      return response;
    },
    issueDelegatedToken: async (request, optionsValue) => {
      const response = await invokeWithClient(
        async (client) => client.appAuth.issueDelegatedToken(request, optionsValue),
      );
      const tokenId = normalizeText(response.tokenId);
      if (tokenId) {
        authEvents.emitTokenIssued(tokenId);
      }
      return response;
    },
    listTokenChain: async (request, optionsValue) => invokeWithClient(
      async (client) => client.appAuth.listTokenChain(request, optionsValue),
    ),
  };
}

export function createScopeClient(
  input: {
    invoke: RuntimeInvoke;
    scopeModule: ScopeModule;
  },
): RuntimeScopeModule {
  const { invoke, scopeModule } = input;
  return {
    register: async (manifestInput) => invoke(
      async () => scopeModule.registerAppScopes({ manifest: manifestInput }),
    ),
    publish: async () => invoke(async () => scopeModule.publishCatalog()),
    revoke: async (revokeInput) => invoke(
      async () => scopeModule.revokeAppScopes({ scopes: revokeInput.scopes }),
    ),
    list: async (listInput) => invoke(async () => scopeModule.listCatalog(listInput)),
  };
}

export function createAiModule(
  input: {
    invokeWithClient: RuntimeInvokeWithClient;
    ctx: RuntimeInternalContext;
  },
): RuntimeAiModule {
  const { invokeWithClient, ctx } = input;
  const withScenarioHeadSubjectUserId = async <T extends {
    head: {
      subjectUserId?: string;
      routePolicy?: number;
      connectorId?: string;
    };
  }>(
    request: T,
    optionsValue?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<Omit<T, 'head'> & {
    head: Omit<T['head'], 'subjectUserId' | 'fallback'> & {
      subjectUserId: string;
      fallback: FallbackPolicy;
    };
  }> => {
    const subjectUserId = runtimeAiRequestRequiresSubject({
      request: { head: request.head },
      metadata: optionsValue?.metadata,
    })
      ? await ctx.resolveSubjectUserId(request.head?.subjectUserId)
      : await ctx.resolveOptionalSubjectUserId(request.head?.subjectUserId);
    const head = {
      ...request.head,
      // High-level SDK surfaces no longer expose app-facing fallback controls.
      // Normalize scenario requests to fail-close here and keep any fallback
      // behavior confined to lower-level internal/runtime strategies.
      fallback: FallbackPolicy.DENY,
      subjectUserId: subjectUserId || '',
    } as Omit<T['head'], 'subjectUserId' | 'fallback'> & {
      subjectUserId: string;
      fallback: FallbackPolicy;
    };
    return {
      ...request,
      head,
    };
  };

  return {
    executeScenario: async (request, optionsValue) => {
      const normalizedRequest = await withScenarioHeadSubjectUserId(
        request as RuntimeAiExecuteScenarioRequestInput,
        optionsValue,
      );
      return invokeWithClient(
        async (client) => client.ai.executeScenario(normalizedRequest, optionsValue),
      );
    },
    streamScenario: async (request, optionsValue) => {
      const normalizedRequest = await withScenarioHeadSubjectUserId(
        request as RuntimeAiStreamScenarioRequestInput,
        optionsValue,
      );
      return invokeWithClient(
        async (client) => client.ai.streamScenario(normalizedRequest, optionsValue),
      );
    },
    submitScenarioJob: async (request, optionsValue) => {
      const normalizedRequest = await withScenarioHeadSubjectUserId(
        request as RuntimeAiSubmitScenarioJobRequestInput,
        optionsValue,
      );
      return invokeWithClient(
        async (client) => client.ai.submitScenarioJob(normalizedRequest, optionsValue),
      );
    },
    getScenarioJob: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.getScenarioJob(request, optionsValue),
    ),
    cancelScenarioJob: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.cancelScenarioJob(request, optionsValue),
    ),
    subscribeScenarioJobEvents: async (request, optionsValue) => {
      return invokeWithClient(
        async (client) => client.ai.subscribeScenarioJobEvents(request, optionsValue),
      );
    },
    getScenarioArtifacts: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.getScenarioArtifacts(request, optionsValue),
    ),
    listScenarioProfiles: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.listScenarioProfiles(request, optionsValue),
    ),
    getVoiceAsset: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.getVoiceAsset(request, optionsValue),
    ),
    listVoiceAssets: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.listVoiceAssets(request, optionsValue),
    ),
    deleteVoiceAsset: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.deleteVoiceAsset(request, optionsValue),
    ),
    listPresetVoices: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.listPresetVoices(request, optionsValue),
    ),
    uploadArtifact: async (uploadInput, optionsValue) => {
      const module = await loadRuntimeAiUploadModule();
      return module.runtimeUploadArtifact(
        ctx,
        uploadInput as RuntimeAiUploadArtifactInput,
        optionsValue,
      );
    },
    openRealtimeSession: async (request, optionsValue) => {
      const normalizedRequest = await withScenarioHeadSubjectUserId(
        request as RuntimeAiOpenRealtimeSessionRequestInput,
        optionsValue,
      );
      return invokeWithClient(
        async (client) => client.ai.openRealtimeSession(normalizedRequest, optionsValue),
      );
    },
    appendRealtimeInput: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.appendRealtimeInput(request, optionsValue),
    ),
    readRealtimeEvents: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.readRealtimeEvents(request, optionsValue),
    ),
    closeRealtimeSession: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.closeRealtimeSession(request, optionsValue),
    ),
    peekScheduling: async (request, optionsValue) => invokeWithClient(
      async (client) => client.ai.peekScheduling(request, optionsValue),
    ),
    text: {
      generate: async (textInput) => runtimeGenerateText(ctx, textInput),
      stream: async (textInput) => runtimeStreamText(ctx, textInput),
    },
    embedding: {
      generate: async (embeddingInput) => runtimeGenerateEmbedding(ctx, embeddingInput),
    },
  };
}

export function createMediaModule(ctx: RuntimeInternalContext): RuntimeMediaModule {
  return {
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
    },
    stt: {
      transcribe: async (input) => runtimeTranscribeSpeech(ctx, input),
    },
    music: {
      generate: async (input) => runtimeGenerateMusic(ctx, input),
      iterate: async (input) => runtimeGenerateMusicIteration(ctx, input),
    },
    jobs: {
      submit: async (input) => runtimeSubmitScenarioJobForMedia(ctx, input),
      get: async (jobId) => runtimeGetScenarioJobForMedia(ctx, jobId),
      cancel: async (input) => runtimeCancelScenarioJobForMedia(ctx, input),
      subscribe: async (jobId) => runtimeSubscribeScenarioJobForMedia(ctx, jobId),
      getArtifacts: async (jobId) => runtimeGetScenarioArtifactsForMedia(ctx, jobId),
    },
  };
}

export function createRawModule(
  input: {
    rawCall: RuntimeRawCall;
    invokeWithClient: RuntimeInvokeWithClient;
  },
): RuntimeUnsafeRawModule {
  const { rawCall, invokeWithClient } = input;
  const call: RuntimeUnsafeRawModule['call'] = async (
    methodId: string,
    rawInput: unknown,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ) => rawCall(methodId, rawInput, options);
  return {
    call,
    closeStream: async (streamId) => invokeWithClient(
      async (client) => client.closeStream(streamId),
    ),
  };
}

export function createHealthEventStreams(input: {
  audit: RuntimeAuditClient;
  wrapModeDStream: <T>(source: AsyncIterable<T>) => AsyncIterable<T>;
}): {
  healthEvents: (
    request?: import('./generated/runtime/v1/audit').SubscribeRuntimeHealthEventsRequest,
    options?: RuntimeStreamCallOptions,
  ) => Promise<AsyncIterable<import('./generated/runtime/v1/audit').RuntimeHealthEvent>>;
  providerHealthEvents: (
    request?: import('./generated/runtime/v1/audit').SubscribeAIProviderHealthEventsRequest,
    options?: RuntimeStreamCallOptions,
  ) => Promise<AsyncIterable<import('./generated/runtime/v1/audit').AIProviderHealthEvent>>;
} {
  return {
    healthEvents: async (request, optionsValue) => {
      const raw = await input.audit.subscribeRuntimeHealthEvents(request || {}, optionsValue);
      return input.wrapModeDStream(raw);
    },
    providerHealthEvents: async (request, optionsValue) => {
      const raw = await input.audit.subscribeAIProviderHealthEvents(request || {}, optionsValue);
      return input.wrapModeDStream(raw);
    },
  };
}

export function emitAuthTokenIssuedEvent(
  eventBus: {
    emit: <K extends keyof RuntimeEventPayloadMap>(name: K, payload: RuntimeEventPayloadMap[K]) => void;
  },
  tokenId: string,
): void {
  eventBus.emit('auth.token.issued', { tokenId, at: nowIso() });
}

export function emitAuthTokenRevokedEvent(
  eventBus: {
    emit: <K extends keyof RuntimeEventPayloadMap>(name: K, payload: RuntimeEventPayloadMap[K]) => void;
  },
  tokenId: string,
): void {
  eventBus.emit('auth.token.revoked', { tokenId, at: nowIso() });
}
