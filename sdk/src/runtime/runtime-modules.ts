import type { ScopeModule } from '../scope/index.js';
import { normalizeText, nowIso, wrapModeBWorkflowStream } from './helpers.js';
import {
  runtimeGenerateText,
  runtimeStreamText,
  runtimeGenerateEmbedding,
} from './runtime-ai-text.js';
import { runtimeUploadArtifact } from './runtime-ai-upload.js';
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
  RuntimeAiExecuteScenarioRequestInput,
  RuntimeAiOpenRealtimeSessionRequestInput,
  RuntimeAiStreamScenarioRequestInput,
  RuntimeAiSubmitScenarioJobRequestInput,
  RuntimeAiUploadArtifactInput,
  RuntimeAppAuthClient,
  RuntimeAuditClient,
  RuntimeAuthClient,
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeConnectorClient,
  RuntimeEventPayloadMap,
  RuntimeEventsModule,
  RuntimeKnowledgeClient,
  RuntimeLocalServiceClient,
  RuntimeMediaModule,
  RuntimeModelClient,
  RuntimeRawModule,
  RuntimeScopeModule,
  RuntimeStreamCallOptions,
  RuntimeWorkflowClient,
} from './types.js';
import type { RuntimeInternalContext } from './internal-context.js';

type RuntimeInvokeWithClient = <T>(operation: (client: RuntimeClient) => Promise<T>) => Promise<T>;

type RuntimeInvoke = <T>(operation: () => Promise<T>) => Promise<T>;

type RuntimePassthroughModuleKey = 'auth' | 'workflow' | 'model' | 'local' | 'connector' | 'knowledge' | 'audit';

type RuntimeRawCall = <TReq, TRes>(
  methodId: string,
  input: TReq,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
) => Promise<TRes>;

type RuntimeModuleAppClient = {
  sendMessage: RuntimeClient['app']['sendAppMessage'];
  subscribeMessages: RuntimeClient['app']['subscribeAppMessages'];
};

type RuntimeAuthEventEmitter = {
  emitTokenIssued: (tokenId: string) => void;
  emitTokenRevoked: (tokenId: string) => void;
};

type RuntimeTelemetryEmitter = (name: string, data?: Record<string, unknown>) => void;

export type RuntimeCorePassthroughClients = {
  auth: RuntimeAuthClient;
  workflow: RuntimeWorkflowClient;
  model: RuntimeModelClient;
  local: RuntimeLocalServiceClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  audit: RuntimeAuditClient;
};

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

  const auth: RuntimeAuthClient = {
    registerApp: async (req, opts) => { guard('auth', 'registerApp'); return invokeWithClient((c) => c.auth.registerApp(req, opts)); },
    openSession: async (req, opts) => { guard('auth', 'openSession'); return invokeWithClient((c) => c.auth.openSession(req, opts)); },
    refreshSession: async (req, opts) => { guard('auth', 'refreshSession'); return invokeWithClient((c) => c.auth.refreshSession(req, opts)); },
    revokeSession: async (req, opts) => { guard('auth', 'revokeSession'); return invokeWithClient((c) => c.auth.revokeSession(req, opts)); },
    registerExternalPrincipal: async (req, opts) => { guard('auth', 'registerExternalPrincipal'); return invokeWithClient((c) => c.auth.registerExternalPrincipal(req, opts)); },
    openExternalPrincipalSession: async (req, opts) => { guard('auth', 'openExternalPrincipalSession'); return invokeWithClient((c) => c.auth.openExternalPrincipalSession(req, opts)); },
    revokeExternalPrincipalSession: async (req, opts) => { guard('auth', 'revokeExternalPrincipalSession'); return invokeWithClient((c) => c.auth.revokeExternalPrincipalSession(req, opts)); },
  };

  const workflow: RuntimeWorkflowClient = {
    submit: async (req, opts) => { guard('workflow', 'submit'); return invokeWithClient((c) => c.workflow.submit(req, opts)); },
    get: async (req, opts) => { guard('workflow', 'get'); return invokeWithClient((c) => c.workflow.get(req, opts)); },
    cancel: async (req, opts) => { guard('workflow', 'cancel'); return invokeWithClient((c) => c.workflow.cancel(req, opts)); },
    subscribeEvents: async (req, opts) => {
      guard('workflow', 'subscribeEvents');
      const raw = await invokeWithClient((c) => c.workflow.subscribeEvents(req, opts));
      return wrapModeBWorkflowStream(raw);
    },
  };

  const model: RuntimeModelClient = {
    list: async (req, opts) => { guard('model', 'list'); return invokeWithClient((c) => c.model.list(req, opts)); },
    pull: async (req, opts) => { guard('model', 'pull'); return invokeWithClient((c) => c.model.pull(req, opts)); },
    remove: async (req, opts) => { guard('model', 'remove'); return invokeWithClient((c) => c.model.remove(req, opts)); },
    checkHealth: async (req, opts) => { guard('model', 'checkHealth'); return invokeWithClient((c) => c.model.checkHealth(req, opts)); },
  };

  const local: RuntimeLocalServiceClient = {
    listLocalModels: async (req, opts) => { guard('local', 'listLocalModels'); return invokeWithClient((c) => c.local.listLocalModels(req, opts)); },
    listLocalArtifacts: async (req, opts) => { guard('local', 'listLocalArtifacts'); return invokeWithClient((c) => c.local.listLocalArtifacts(req, opts)); },
    listVerifiedModels: async (req, opts) => { guard('local', 'listVerifiedModels'); return invokeWithClient((c) => c.local.listVerifiedModels(req, opts)); },
    listVerifiedArtifacts: async (req, opts) => { guard('local', 'listVerifiedArtifacts'); return invokeWithClient((c) => c.local.listVerifiedArtifacts(req, opts)); },
    searchCatalogModels: async (req, opts) => { guard('local', 'searchCatalogModels'); return invokeWithClient((c) => c.local.searchCatalogModels(req, opts)); },
    resolveModelInstallPlan: async (req, opts) => { guard('local', 'resolveModelInstallPlan'); return invokeWithClient((c) => c.local.resolveModelInstallPlan(req, opts)); },
    installLocalModel: async (req, opts) => { guard('local', 'installLocalModel'); return invokeWithClient((c) => c.local.installLocalModel(req, opts)); },
    installVerifiedModel: async (req, opts) => { guard('local', 'installVerifiedModel'); return invokeWithClient((c) => c.local.installVerifiedModel(req, opts)); },
    installVerifiedArtifact: async (req, opts) => { guard('local', 'installVerifiedArtifact'); return invokeWithClient((c) => c.local.installVerifiedArtifact(req, opts)); },
    importLocalModel: async (req, opts) => { guard('local', 'importLocalModel'); return invokeWithClient((c) => c.local.importLocalModel(req, opts)); },
    importLocalArtifact: async (req, opts) => { guard('local', 'importLocalArtifact'); return invokeWithClient((c) => c.local.importLocalArtifact(req, opts)); },
    removeLocalModel: async (req, opts) => { guard('local', 'removeLocalModel'); return invokeWithClient((c) => c.local.removeLocalModel(req, opts)); },
    removeLocalArtifact: async (req, opts) => { guard('local', 'removeLocalArtifact'); return invokeWithClient((c) => c.local.removeLocalArtifact(req, opts)); },
    startLocalModel: async (req, opts) => { guard('local', 'startLocalModel'); return invokeWithClient((c) => c.local.startLocalModel(req, opts)); },
    stopLocalModel: async (req, opts) => { guard('local', 'stopLocalModel'); return invokeWithClient((c) => c.local.stopLocalModel(req, opts)); },
    checkLocalModelHealth: async (req, opts) => { guard('local', 'checkLocalModelHealth'); return invokeWithClient((c) => c.local.checkLocalModelHealth(req, opts)); },
    warmLocalModel: async (req, opts) => { guard('local', 'warmLocalModel'); return invokeWithClient((c) => c.local.warmLocalModel(req, opts)); },
    collectDeviceProfile: async (req, opts) => { guard('local', 'collectDeviceProfile'); return invokeWithClient((c) => c.local.collectDeviceProfile(req, opts)); },
    resolveProfile: async (req, opts) => { guard('local', 'resolveProfile'); return invokeWithClient((c) => c.local.resolveProfile(req, opts)); },
    applyProfile: async (req, opts) => { guard('local', 'applyProfile'); return invokeWithClient((c) => c.local.applyProfile(req, opts)); },
    listLocalServices: async (req, opts) => { guard('local', 'listLocalServices'); return invokeWithClient((c) => c.local.listLocalServices(req, opts)); },
    installLocalService: async (req, opts) => { guard('local', 'installLocalService'); return invokeWithClient((c) => c.local.installLocalService(req, opts)); },
    startLocalService: async (req, opts) => { guard('local', 'startLocalService'); return invokeWithClient((c) => c.local.startLocalService(req, opts)); },
    stopLocalService: async (req, opts) => { guard('local', 'stopLocalService'); return invokeWithClient((c) => c.local.stopLocalService(req, opts)); },
    checkLocalServiceHealth: async (req, opts) => { guard('local', 'checkLocalServiceHealth'); return invokeWithClient((c) => c.local.checkLocalServiceHealth(req, opts)); },
    removeLocalService: async (req, opts) => { guard('local', 'removeLocalService'); return invokeWithClient((c) => c.local.removeLocalService(req, opts)); },
    listNodeCatalog: async (req, opts) => { guard('local', 'listNodeCatalog'); return invokeWithClient((c) => c.local.listNodeCatalog(req, opts)); },
    listLocalAudits: async (req, opts) => { guard('local', 'listLocalAudits'); return invokeWithClient((c) => c.local.listLocalAudits(req, opts)); },
    appendInferenceAudit: async (req, opts) => { guard('local', 'appendInferenceAudit'); return invokeWithClient((c) => c.local.appendInferenceAudit(req, opts)); },
    appendRuntimeAudit: async (req, opts) => { guard('local', 'appendRuntimeAudit'); return invokeWithClient((c) => c.local.appendRuntimeAudit(req, opts)); },
    listEngines: async (req, opts) => { guard('local', 'listEngines'); return invokeWithClient((c) => c.local.listEngines(req, opts)); },
    ensureEngine: async (req, opts) => { guard('local', 'ensureEngine'); return invokeWithClient((c) => c.local.ensureEngine(req, opts)); },
    startEngine: async (req, opts) => { guard('local', 'startEngine'); return invokeWithClient((c) => c.local.startEngine(req, opts)); },
    stopEngine: async (req, opts) => { guard('local', 'stopEngine'); return invokeWithClient((c) => c.local.stopEngine(req, opts)); },
    getEngineStatus: async (req, opts) => { guard('local', 'getEngineStatus'); return invokeWithClient((c) => c.local.getEngineStatus(req, opts)); },
  };

  const connector: RuntimeConnectorClient = {
    createConnector: async (req, opts) => { guard('connector', 'createConnector'); return invokeWithClient((c) => c.connector.createConnector(req, opts)); },
    getConnector: async (req, opts) => { guard('connector', 'getConnector'); return invokeWithClient((c) => c.connector.getConnector(req, opts)); },
    listConnectors: async (req, opts) => { guard('connector', 'listConnectors'); return invokeWithClient((c) => c.connector.listConnectors(req, opts)); },
    updateConnector: async (req, opts) => { guard('connector', 'updateConnector'); return invokeWithClient((c) => c.connector.updateConnector(req, opts)); },
    deleteConnector: async (req, opts) => { guard('connector', 'deleteConnector'); return invokeWithClient((c) => c.connector.deleteConnector(req, opts)); },
    testConnector: async (req, opts) => { guard('connector', 'testConnector'); return invokeWithClient((c) => c.connector.testConnector(req, opts)); },
    listConnectorModels: async (req, opts) => { guard('connector', 'listConnectorModels'); return invokeWithClient((c) => c.connector.listConnectorModels(req, opts)); },
    listProviderCatalog: async (req, opts) => { guard('connector', 'listProviderCatalog'); return invokeWithClient((c) => c.connector.listProviderCatalog(req, opts)); },
    listModelCatalogProviders: async (req, opts) => { guard('connector', 'listModelCatalogProviders'); return invokeWithClient((c) => c.connector.listModelCatalogProviders(req, opts)); },
    upsertModelCatalogProvider: async (req, opts) => { guard('connector', 'upsertModelCatalogProvider'); return invokeWithClient((c) => c.connector.upsertModelCatalogProvider(req, opts)); },
    deleteModelCatalogProvider: async (req, opts) => { guard('connector', 'deleteModelCatalogProvider'); return invokeWithClient((c) => c.connector.deleteModelCatalogProvider(req, opts)); },
  };

  const knowledge: RuntimeKnowledgeClient = {
    buildIndex: async (req, opts) => { guard('knowledge', 'buildIndex'); return invokeWithClient((c) => c.knowledge.buildIndex(req, opts)); },
    searchIndex: async (req, opts) => { guard('knowledge', 'searchIndex'); return invokeWithClient((c) => c.knowledge.searchIndex(req, opts)); },
    deleteIndex: async (req, opts) => { guard('knowledge', 'deleteIndex'); return invokeWithClient((c) => c.knowledge.deleteIndex(req, opts)); },
  };

  const audit: RuntimeAuditClient = {
    listAuditEvents: async (req, opts) => { guard('audit', 'listAuditEvents'); return invokeWithClient((c) => c.audit.listAuditEvents(req, opts)); },
    exportAuditEvents: async (req, opts) => { guard('audit', 'exportAuditEvents'); return invokeWithClient((c) => c.audit.exportAuditEvents(req, opts)); },
    listUsageStats: async (req, opts) => { guard('audit', 'listUsageStats'); return invokeWithClient((c) => c.audit.listUsageStats(req, opts)); },
    getRuntimeHealth: async (req, opts) => { guard('audit', 'getRuntimeHealth'); return invokeWithClient((c) => c.audit.getRuntimeHealth(req, opts)); },
    listAIProviderHealth: async (req, opts) => { guard('audit', 'listAIProviderHealth'); return invokeWithClient((c) => c.audit.listAIProviderHealth(req, opts)); },
    subscribeAIProviderHealthEvents: async (req, opts) => { guard('audit', 'subscribeAIProviderHealthEvents'); return invokeWithClient((c) => c.audit.subscribeAIProviderHealthEvents(req, opts)); },
    subscribeRuntimeHealthEvents: async (req, opts) => { guard('audit', 'subscribeRuntimeHealthEvents'); return invokeWithClient((c) => c.audit.subscribeRuntimeHealthEvents(req, opts)); },
  };

  return { auth, workflow, model, local, connector, knowledge, audit };
}

export function createAppClient(invokeWithClient: RuntimeInvokeWithClient): RuntimeModuleAppClient {
  return {
    sendMessage: async (request, options) => invokeWithClient(
      async (client) => client.app.sendAppMessage(request, options),
    ),
    subscribeMessages: async (request, options) => invokeWithClient(
      async (client) => client.app.subscribeAppMessages(request, options),
    ),
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

      const issuedScopeCatalogVersion = normalizeText(
        (response as unknown as Record<string, unknown>).issuedScopeCatalogVersion,
      );
      if (issuedScopeCatalogVersion && issuedScopeCatalogVersion !== resolvedScopeCatalogVersion) {
        emitTelemetry('runtime.app-auth.scope-version-mismatch', {
          requested: resolvedScopeCatalogVersion,
          issued: issuedScopeCatalogVersion,
        });
      }

      const tokenId = normalizeText((response as unknown as Record<string, unknown>).tokenId);
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
      const tokenId = normalizeText((request as unknown as Record<string, unknown>).tokenId);
      if (tokenId) {
        authEvents.emitTokenRevoked(tokenId);
      }
      return response;
    },
    issueDelegatedToken: async (request, optionsValue) => {
      const response = await invokeWithClient(
        async (client) => client.appAuth.issueDelegatedToken(request, optionsValue),
      );
      const tokenId = normalizeText((response as unknown as Record<string, unknown>).tokenId);
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
  const withScenarioHeadSubjectUserId = async <T extends { head: { subjectUserId?: string; routePolicy?: number; connectorId?: string } }>(
    request: T,
    optionsValue?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<Omit<T, 'head'> & { head: Omit<T['head'], 'subjectUserId'> & { subjectUserId: string } }> => {
    const subjectUserId = runtimeAiRequestRequiresSubject({
      request: { head: request.head },
      metadata: optionsValue?.metadata,
    })
      ? await ctx.resolveSubjectUserId(request.head?.subjectUserId)
      : await ctx.resolveOptionalSubjectUserId(request.head?.subjectUserId);
    const head = {
      ...request.head,
      subjectUserId: subjectUserId || '',
    } as Omit<T['head'], 'subjectUserId'> & { subjectUserId: string };
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
    uploadArtifact: async (uploadInput, optionsValue) => runtimeUploadArtifact(
      ctx,
      uploadInput as RuntimeAiUploadArtifactInput,
      optionsValue,
    ),
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
): RuntimeRawModule {
  const { rawCall, invokeWithClient } = input;
  return {
    call: async (methodId, rawInput, options) => rawCall(methodId, rawInput, options),
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
