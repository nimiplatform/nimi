import type { ScopeModule } from '../scope/index.js';
import { normalizeText, nowIso, wrapModeBWorkflowStream } from './helpers.js';
import {
  runtimeGenerateText,
  runtimeStreamText,
  runtimeGenerateEmbedding,
} from './runtime-ai-text.js';
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
  RuntimeAiStreamScenarioRequestInput,
  RuntimeAiSubmitScenarioJobRequestInput,
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
  RuntimeScriptWorkerClient,
  RuntimeScopeModule,
  RuntimeStreamCallOptions,
  RuntimeWorkflowClient,
} from './types.js';
import type { RuntimeInternalContext } from './internal-context.js';

export type RuntimeInvokeWithClient = <T>(operation: (client: RuntimeClient) => Promise<T>) => Promise<T>;

export type RuntimeInvoke = <T>(operation: () => Promise<T>) => Promise<T>;

export type RuntimePassthroughModuleKey = keyof Pick<RuntimeClient,
  'auth'
  | 'workflow'
  | 'model'
  | 'local'
  | 'connector'
  | 'knowledge'
  | 'audit'
  | 'scriptWorker'
>;

export type RuntimeRawCall = <TReq, TRes>(
  methodId: string,
  input: TReq,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
) => Promise<TRes>;

export type RuntimeAppClient = {
  sendMessage: RuntimeClient['app']['sendAppMessage'];
  subscribeMessages: RuntimeClient['app']['subscribeAppMessages'];
};

export type RuntimeAuthEventEmitter = {
  emitTokenIssued: (tokenId: string) => void;
  emitTokenRevoked: (tokenId: string) => void;
};

export type RuntimeTelemetryEmitter = (name: string, data?: Record<string, unknown>) => void;

export type RuntimeCorePassthroughClients = {
  auth: RuntimeAuthClient;
  workflow: RuntimeWorkflowClient;
  model: RuntimeModelClient;
  local: RuntimeLocalServiceClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  audit: RuntimeAuditClient;
  scriptWorker: RuntimeScriptWorkerClient;
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

export function createPassthroughModule<Module>(
  input: {
    moduleKey: RuntimePassthroughModuleKey;
    assertMethodAvailable: (moduleKey: string, methodKey: string) => void;
    invokeWithClient: RuntimeInvokeWithClient;
    createMethodNotImplementedError: (moduleKey: RuntimePassthroughModuleKey, methodKey: string) => Error;
  },
): Module {
  const {
    moduleKey,
    assertMethodAvailable,
    invokeWithClient,
    createMethodNotImplementedError,
  } = input;
  return new Proxy({} as Record<string, unknown>, {
    get: (_target, property: string | symbol) => {
      if (typeof property !== 'string') {
        return undefined;
      }

      return async (...args: unknown[]) => {
        assertMethodAvailable(moduleKey, property);
        return invokeWithClient(async (client) => {
          const module = (client as unknown as Record<string, unknown>)[moduleKey] as Record<string, unknown>;
          const method = module[property];
          if (typeof method !== 'function') {
            throw createMethodNotImplementedError(moduleKey, property);
          }
          return (method as (...innerArgs: unknown[]) => Promise<unknown>)(...args);
        });
      };
    },
  }) as unknown as Module;
}

export function createWorkflowClient(passthrough: RuntimeWorkflowClient): RuntimeWorkflowClient {
  return {
    submit: passthrough.submit,
    get: passthrough.get,
    cancel: passthrough.cancel,
    subscribeEvents: async (request, options) => {
      const raw = await passthrough.subscribeEvents(request, options);
      return wrapModeBWorkflowStream(raw);
    },
  };
}

export function createCorePassthroughClients(input: {
  assertMethodAvailable: (moduleKey: string, methodKey: string) => void;
  invokeWithClient: RuntimeInvokeWithClient;
  createMethodNotImplementedError: (moduleKey: RuntimePassthroughModuleKey, methodKey: string) => Error;
}): RuntimeCorePassthroughClients {
  const create = <T>(moduleKey: RuntimePassthroughModuleKey): T => createPassthroughModule<T>({
    moduleKey,
    assertMethodAvailable: input.assertMethodAvailable,
    invokeWithClient: input.invokeWithClient,
    createMethodNotImplementedError: input.createMethodNotImplementedError,
  });
  const workflowPassthrough = create<RuntimeWorkflowClient>('workflow');
  return {
    auth: create<RuntimeAuthClient>('auth'),
    workflow: createWorkflowClient(workflowPassthrough),
    model: create<RuntimeModelClient>('model'),
    local: create<RuntimeLocalServiceClient>('local'),
    connector: create<RuntimeConnectorClient>('connector'),
    knowledge: create<RuntimeKnowledgeClient>('knowledge'),
    audit: create<RuntimeAuditClient>('audit'),
    scriptWorker: create<RuntimeScriptWorkerClient>('scriptWorker'),
  };
}

export function createAppClient(invokeWithClient: RuntimeInvokeWithClient): RuntimeAppClient {
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
