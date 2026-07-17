import { createNimiError } from './types';
import {
  Runtime,
  createRuntime,
  createNimiRuntimeAgentClient,
  type NimiRuntimeAgentClientOptions,
  type RuntimeOptions,
} from './runtime';
import { Realm, createRealm, type RealmOptions } from './realm';
import {
  NimiAppClient,
  PermissionClient,
  createNimiAppClient,
  createPermissionClient,
  createScopeCatalogModule,
  type NimiAppTransport,
  type PermissionTransport,
  type ScopeCatalogModule,
} from './core/app';
import {
  createNimiRuntimeAIModel,
  createNimiRuntimeAISchedulingClient,
  createNimiRuntimeEmbeddingClient,
  type NimiRuntimeAIModelOptions,
  type NimiRuntimeAISchedulingClientOptions,
  type NimiRuntimeEmbeddingClientOptions,
} from './core/ai';
import {
  createNimiAiRunner,
  runNimiAiRunner,
  streamNimiAiRunner,
  type NimiAiRunnerRunRequest,
  type NimiAiRunnerRunResult,
} from './core/ai-runner';
import {
  createNimiRuntimeGenerationClient,
  type NimiRuntimeGenerationClientOptions,
  type NimiRuntimeGenerationHeadInput,
} from './features/generation';
import {
  createNimiRuntimeKnowledgeAiContextProvider,
  createNimiRuntimeKnowledgeContextClient,
  type NimiRuntimeKnowledgeAiContextProviderOptions,
  type NimiRuntimeKnowledgeContextClientOptions,
} from './features/knowledge-context';
import {
  createNimiRuntimeMemoryAiContextProvider,
  createNimiRuntimeMemoryContextClient,
  type NimiRuntimeMemoryAiContextProviderOptions,
  type NimiRuntimeMemoryContextClientOptions,
} from './features/memory-context';
import {
  executeWorldWorkflowPlan,
  type WorldWorkflowPlan,
} from './features/workflow';

export interface NimiClientConfig {
  readonly appId?: string;
  readonly runtime?: Runtime | RuntimeOptions;
  readonly realm?: Realm | RealmOptions | false;
  readonly app?: NimiAppClient | NimiAppTransport | false;
  readonly permissions?: PermissionClient | PermissionTransport | false;
  readonly scopeCatalog?: {
    readonly appId?: string;
    readonly defaultRealmScopes?: readonly string[];
    readonly defaultRuntimeScopes?: readonly string[];
  } | false;
}

export type NimiClientRuntimeModelOptions =
  Omit<NimiRuntimeAIModelOptions, 'runtime' | 'appId'> & {
    readonly runtime?: NimiRuntimeAIModelOptions['runtime'];
    readonly appId?: string;
  };

export type NimiClientEmbeddingOptions =
  Omit<NimiRuntimeEmbeddingClientOptions, 'runtime' | 'appId'> & {
    readonly runtime?: NimiRuntimeEmbeddingClientOptions['runtime'];
    readonly appId?: string;
  };

export type NimiClientSchedulingOptions =
  Omit<NimiRuntimeAISchedulingClientOptions, 'runtime' | 'appId'> & {
    readonly runtime?: NimiRuntimeAISchedulingClientOptions['runtime'];
    readonly appId?: string;
  };

export type NimiClientGenerationOptions =
  Omit<NimiRuntimeGenerationClientOptions, 'runtime' | 'head'> & {
    readonly runtime?: NimiRuntimeGenerationClientOptions['runtime'];
    readonly head?: Partial<NimiRuntimeGenerationHeadInput>;
  };

export type NimiClientKnowledgeOptions =
  Omit<NimiRuntimeKnowledgeContextClientOptions, 'runtime' | 'context'> & {
    readonly runtime?: NimiRuntimeKnowledgeContextClientOptions['runtime'];
    readonly context?: Partial<NimiRuntimeKnowledgeContextClientOptions['context']>;
  };

export type NimiClientMemoryOptions =
  Omit<NimiRuntimeMemoryContextClientOptions, 'runtime' | 'context'> & {
    readonly runtime?: NimiRuntimeMemoryContextClientOptions['runtime'];
    readonly context?: Partial<NimiRuntimeMemoryContextClientOptions['context']>;
  };

export type NimiClientRuntimeAgentOptions =
  Omit<NimiRuntimeAgentClientOptions, 'runtime' | 'appId'> & {
    readonly runtime?: NimiRuntimeAgentClientOptions['runtime'];
    readonly appId?: string;
  };

export type NimiClientLocalAgentMemoryContextProviderOptions =
  Omit<NimiRuntimeMemoryAiContextProviderOptions, 'client'> &
  Omit<NimiRuntimeMemoryContextClientOptions, 'runtime' | 'context'> & {
    readonly runtime?: NimiRuntimeMemoryContextClientOptions['runtime'];
    readonly context?: Partial<NimiRuntimeMemoryContextClientOptions['context']>;
  };

export type NimiClientLocalAgentKnowledgeContextProviderOptions =
  Omit<NimiRuntimeKnowledgeAiContextProviderOptions, 'client'> &
  Omit<NimiRuntimeKnowledgeContextClientOptions, 'runtime' | 'context'> & {
    readonly runtime?: NimiRuntimeKnowledgeContextClientOptions['runtime'];
    readonly context?: Partial<NimiRuntimeKnowledgeContextClientOptions['context']>;
  };

export interface NimiClientAiSurface {
  createRuntimeModel(options: NimiClientRuntimeModelOptions): ReturnType<typeof createNimiRuntimeAIModel>;
  createRuntimeEmbeddingClient(options: NimiClientEmbeddingOptions): ReturnType<typeof createNimiRuntimeEmbeddingClient>;
  createRuntimeSchedulingClient(options: NimiClientSchedulingOptions): ReturnType<typeof createNimiRuntimeAISchedulingClient>;
  readonly runner: {
    createRunner: typeof createNimiAiRunner;
    run(request: NimiAiRunnerRunRequest): Promise<NimiAiRunnerRunResult>;
    stream: typeof streamNimiAiRunner;
  };
}

export interface NimiClientLocalAgentSurface {
  createRuntimeClient(options: NimiClientRuntimeAgentOptions): ReturnType<typeof createNimiRuntimeAgentClient>;
  createMemoryContextProvider(options: NimiClientLocalAgentMemoryContextProviderOptions): ReturnType<typeof createNimiRuntimeMemoryAiContextProvider>;
  createKnowledgeContextProvider(options: NimiClientLocalAgentKnowledgeContextProviderOptions): ReturnType<typeof createNimiRuntimeKnowledgeAiContextProvider>;
}

export interface NimiClientFeatureSurface {
  generation: {
    createRuntimeClient(options: NimiClientGenerationOptions): ReturnType<typeof createNimiRuntimeGenerationClient>;
  };
  knowledge: {
    createRuntimeContextClient(options: NimiClientKnowledgeOptions): ReturnType<typeof createNimiRuntimeKnowledgeContextClient>;
  };
  memory: {
    createRuntimeContextClient(options: NimiClientMemoryOptions): ReturnType<typeof createNimiRuntimeMemoryContextClient>;
  };
  world: {
    execute(plan: WorldWorkflowPlan, realm?: Realm): ReturnType<typeof executeWorldWorkflowPlan>;
  };
}

export class NimiClient {
  readonly appId?: string;
  readonly runtime: Runtime;
  readonly realm?: Realm;
  readonly app?: NimiAppClient;
  readonly permissions?: PermissionClient;
  readonly scopes?: ScopeCatalogModule;
  readonly ai: NimiClientAiSurface;
  readonly localAgent: NimiClientLocalAgentSurface;
  readonly features: NimiClientFeatureSurface;

  constructor(config: NimiClientConfig = {}) {
    this.appId = normalizeText(config.appId) || undefined;
    this.runtime = config.runtime instanceof Runtime ? config.runtime : createRuntime(config.runtime ?? {});
    this.realm = createOptionalRealm(config.realm);
    this.app = createOptionalAppClient(config.app);
    this.permissions = createOptionalPermissionClient(config.permissions);
    this.scopes = createOptionalScopeCatalog(config.scopeCatalog, this.appId);
    this.ai = createAiSurface(this);
    this.localAgent = createLocalAgentSurface(this);
    this.features = createFeatureSurface(this);
  }

  requireRealm(): Realm {
    if (!this.realm) {
      throwClientConfigurationError('SDK_CLIENT_REALM_REQUIRED', 'NimiClient realm access requires explicit realm configuration', 'provide_realm_config');
    }
    return this.realm;
  }

  requireApp(): NimiAppClient {
    if (!this.app) {
      throwClientConfigurationError('SDK_CLIENT_APP_REQUIRED', 'NimiClient app access requires explicit app transport', 'provide_app_transport');
    }
    return this.app;
  }

  requirePermissions(): PermissionClient {
    if (!this.permissions) {
      throwClientConfigurationError('SDK_CLIENT_PERMISSIONS_REQUIRED', 'NimiClient permissions access requires explicit permission transport', 'provide_permission_transport');
    }
    return this.permissions;
  }

  requireScopes(): ScopeCatalogModule {
    if (!this.scopes) {
      throwClientConfigurationError('SDK_CLIENT_SCOPE_CATALOG_REQUIRED', 'NimiClient scope catalog requires appId or explicit scopeCatalog config', 'provide_client_app_id');
    }
    return this.scopes;
  }
}

export function createNimiClient(config: NimiClientConfig = {}): NimiClient {
  return new NimiClient(config);
}

function createAiSurface(client: NimiClient): NimiClientAiSurface {
  return {
    runner: {
      createRunner: createNimiAiRunner,
      run: runNimiAiRunner,
      stream: streamNimiAiRunner,
    },
    createRuntimeModel(options) {
      return createNimiRuntimeAIModel({
        ...options,
        appId: resolveAppId(client, options.appId, 'provide_runtime_ai_app_id'),
        runtime: options.runtime ?? client.runtime,
      });
    },
    createRuntimeEmbeddingClient(options) {
      return createNimiRuntimeEmbeddingClient({
        ...options,
        appId: resolveAppId(client, options.appId, 'provide_embedding_app_id'),
        runtime: options.runtime ?? client.runtime,
      });
    },
    createRuntimeSchedulingClient(options) {
      return createNimiRuntimeAISchedulingClient({
        ...options,
        appId: resolveAppId(client, options.appId, 'provide_runtime_ai_scheduling_app_id'),
        runtime: options.runtime ?? client.runtime,
      });
    },
  };
}

function createLocalAgentSurface(client: NimiClient): NimiClientLocalAgentSurface {
  return {
    createRuntimeClient(options) {
      return createNimiRuntimeAgentClient({
        ...options,
        appId: resolveAppId(client, options.appId, 'provide_runtime_agent_app_id'),
        runtime: options.runtime ?? client.runtime,
      });
    },
    createMemoryContextProvider(options) {
      return createNimiRuntimeMemoryAiContextProvider({
        id: options.id,
        query: options.query,
        recall: options.recall,
        client: createNimiRuntimeMemoryContextClient({
          ...options,
          runtime: options.runtime ?? client.runtime,
          context: {
            ...options.context,
            appId: resolveAppId(client, options.context?.appId, 'provide_memory_context_app_id'),
          },
        }),
      });
    },
    createKnowledgeContextProvider(options) {
      return createNimiRuntimeKnowledgeAiContextProvider({
        id: options.id,
        query: options.query,
        search: options.search,
        client: createNimiRuntimeKnowledgeContextClient({
          ...options,
          runtime: options.runtime ?? client.runtime,
          context: {
            ...options.context,
            appId: resolveAppId(client, options.context?.appId, 'provide_knowledge_context_app_id'),
          },
        }),
      });
    },
  };
}

function createFeatureSurface(client: NimiClient): NimiClientFeatureSurface {
  return {
    generation: {
      createRuntimeClient(options) {
        return createNimiRuntimeGenerationClient({
          ...options,
          runtime: options.runtime ?? client.runtime,
          head: {
            ...options.head,
            appId: resolveAppId(client, options.head?.appId, 'provide_generation_app_id'),
          },
        });
      },
    },
    knowledge: {
      createRuntimeContextClient(options) {
        return createNimiRuntimeKnowledgeContextClient({
          ...options,
          runtime: options.runtime ?? client.runtime,
          context: {
            ...options.context,
            appId: resolveAppId(client, options.context?.appId, 'provide_knowledge_context_app_id'),
          },
        });
      },
    },
    memory: {
      createRuntimeContextClient(options) {
        return createNimiRuntimeMemoryContextClient({
          ...options,
          runtime: options.runtime ?? client.runtime,
          context: {
            ...options.context,
            appId: resolveAppId(client, options.context?.appId, 'provide_memory_context_app_id'),
          },
        });
      },
    },
    world: {
      execute(plan, realm) {
        return executeWorldWorkflowPlan(realm ?? client.requireRealm(), plan);
      },
    },
  };
}

function createOptionalRealm(config: NimiClientConfig['realm']): Realm | undefined {
  if (!config) return undefined;
  return config instanceof Realm ? config : createRealm(config);
}

function createOptionalAppClient(config: NimiClientConfig['app']): NimiAppClient | undefined {
  if (!config) return undefined;
  return config instanceof NimiAppClient ? config : createNimiAppClient(config);
}

function createOptionalPermissionClient(
  config: NimiClientConfig['permissions'],
): PermissionClient | undefined {
  if (!config) return undefined;
  return config instanceof PermissionClient ? config : createPermissionClient(config);
}

function createOptionalScopeCatalog(
  config: NimiClientConfig['scopeCatalog'],
  clientAppId: string | undefined,
): ScopeCatalogModule | undefined {
  if (config === false) return undefined;
  const appId = normalizeText(config?.appId) || clientAppId;
  if (!appId) return undefined;
  return createScopeCatalogModule({
    appId,
    defaultRealmScopes: config?.defaultRealmScopes,
    defaultRuntimeScopes: config?.defaultRuntimeScopes,
  });
}

function resolveAppId(client: NimiClient, override: unknown, actionHint: string): string {
  const appId = normalizeText(override) || client.appId;
  if (!appId) {
    throwClientConfigurationError('SDK_CLIENT_APP_ID_REQUIRED', 'NimiClient operation requires appId', actionHint);
  }
  return appId;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function throwClientConfigurationError(code: string, message: string, actionHint: string): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
