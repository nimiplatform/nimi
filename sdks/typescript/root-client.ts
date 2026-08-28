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
  createNimiAppClient,
  type NimiAppTransport,
} from './core/app';
import {
  createNimiLocalAppClient,
  type NimiLocalAppClient,
  type NimiLocalAppClientInput,
} from './core/app/local-app-runtime-platform';
import {
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
  type NimiRuntimeAIModelOptions,
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
export interface NimiDirectClientConfig {
  readonly appId?: string;
  readonly runtime?: Runtime | RuntimeOptions;
  readonly realm?: Realm | RealmOptions | false;
  readonly app?: NimiAppClient | NimiAppTransport | false;
}

export interface NimiClientLocalAppConfig {
  readonly localApp: NimiLocalAppClientInput;
}

export type NimiClientConfig = NimiDirectClientConfig | NimiClientLocalAppConfig;

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

export type NimiClientGenerationOptions =
  Omit<NimiRuntimeGenerationClientOptions, 'runtime' | 'head'> & {
    readonly runtime?: NimiRuntimeGenerationClientOptions['runtime'];
    readonly head?: Partial<NimiRuntimeGenerationHeadInput>;
  };

export type NimiClientRuntimeAgentOptions =
  Omit<NimiRuntimeAgentClientOptions, 'runtime' | 'appId'> & {
    readonly runtime?: NimiRuntimeAgentClientOptions['runtime'];
    readonly appId?: string;
  };


export interface NimiClientAiSurface {
  createRuntimeModel(options: NimiClientRuntimeModelOptions): ReturnType<typeof createNimiRuntimeAIModel>;
  createRuntimeEmbeddingClient(options: NimiClientEmbeddingOptions): ReturnType<typeof createNimiRuntimeEmbeddingClient>;
  readonly runner: {
    createRunner: typeof createNimiAiRunner;
    run(request: NimiAiRunnerRunRequest): Promise<NimiAiRunnerRunResult>;
    stream: typeof streamNimiAiRunner;
  };
}

export interface NimiClientLocalAgentSurface {
  createRuntimeClient(options: NimiClientRuntimeAgentOptions): ReturnType<typeof createNimiRuntimeAgentClient>;
}

export interface NimiClientFeatureSurface {
  generation: {
    createRuntimeClient(options: NimiClientGenerationOptions): ReturnType<typeof createNimiRuntimeGenerationClient>;
  };
}

// @nimi-authority: definition.nimi.sdks.client-core.public-surface-plane
// @nimi-authority: rule.nimi.sdks.client-core.r002
// @nimi-authority: rule.nimi.sdks.client-core.r003
// @nimi-authority: rule.nimi.sdks.client-core.r006
export class NimiClient {
  readonly appId?: string;
  readonly runtime: Runtime;
  readonly realm?: Realm;
  readonly app?: NimiAppClient;
  readonly ai: NimiClientAiSurface;
  readonly localAgent: NimiClientLocalAgentSurface;
  readonly features: NimiClientFeatureSurface;

  constructor(config: NimiDirectClientConfig = {}) {
    this.appId = normalizeText(config.appId) || undefined;
    this.runtime = config.runtime instanceof Runtime ? config.runtime : createRuntime(config.runtime ?? {});
    this.realm = createOptionalRealm(config.realm);
    this.app = createOptionalAppClient(config.app);
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

}

export function createNimiClient(config: NimiClientLocalAppConfig): NimiLocalAppClient;
export function createNimiClient(config?: NimiDirectClientConfig): NimiClient;
export function createNimiClient(config: NimiClientConfig = {}): NimiClient | NimiLocalAppClient {
  if ('localApp' in config) {
    assertExactClientConfigKeys(config, ['localApp'], 'local-app NimiClient config');
    return createNimiLocalAppClient(config.localApp);
  }
  return new NimiClient(config);
}

function assertExactClientConfigKeys(
  value: object,
  allowedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throwClientConfigurationError(
      'SDK_CLIENT_CONFIG_INVALID',
      `${label} must contain exactly: ${expected.join(', ')}`,
      'remove_unadmitted_client_config_fields',
    );
  }
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
  };
}

function createOptionalRealm(config: NimiDirectClientConfig['realm']): Realm | undefined {
  if (!config) return undefined;
  return config instanceof Realm ? config : createRealm(config);
}

function createOptionalAppClient(config: NimiDirectClientConfig['app']): NimiAppClient | undefined {
  if (!config) return undefined;
  return config instanceof NimiAppClient ? config : createNimiAppClient(config);
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
