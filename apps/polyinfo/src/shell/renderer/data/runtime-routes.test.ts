import { beforeEach, describe, expect, it } from 'vitest';
import {
  getTextGenerateBinding,
  loadPersistedAIConfig,
  resolveTextGenerateRouteStatus,
  summarizeRuntimeBinding,
} from './runtime-routes.js';

describe('runtime route migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('migrates legacy analyst runtime settings into ai config storage', () => {
    window.localStorage.setItem('nimi:polyinfo:analyst-runtime:v1', JSON.stringify({
      route: 'cloud',
      cloudConnectorId: 'connector-openai',
      cloudModel: 'gpt-5.4',
    }));

    const config = loadPersistedAIConfig({
      realm: {
        realmBaseUrl: 'https://realm.example.com',
        realtimeUrl: 'wss://realm.example.com/ws',
        accessToken: '',
        jwksUrl: 'https://realm.example.com/jwks',
        revocationUrl: 'https://realm.example.com/revoke',
        jwtIssuer: 'https://realm.example.com',
        jwtAudience: 'nimi',
      },
      runtime: {
        provider: 'openai',
        connectorId: 'connector-default',
        localProviderModel: 'llama3',
        localProviderEndpoint: 'http://127.0.0.1:11434',
        localOpenAiEndpoint: '',
        targetType: '',
        targetAccountId: '',
        agentId: '',
        worldId: '',
        userConfirmedUpload: false,
      },
    });

    expect(getTextGenerateBinding(config)).toEqual({
      source: 'cloud',
      connectorId: 'connector-openai',
      model: 'gpt-5.4',
      provider: 'openai',
    });
    expect(window.localStorage.getItem('nimi:polyinfo:analyst-runtime:v1')).toBeNull();
    expect(window.localStorage.getItem('nimi:polyinfo:ai-config:v1')).toContain('connector-openai');
  });

  it('does not persist runtime defaults as a user-selected binding when no saved config exists', () => {
    const config = loadPersistedAIConfig({
      realm: {
        realmBaseUrl: 'https://realm.example.com',
        realtimeUrl: 'wss://realm.example.com/ws',
        accessToken: '',
        jwksUrl: 'https://realm.example.com/jwks',
        revocationUrl: 'https://realm.example.com/revoke',
        jwtIssuer: 'https://realm.example.com',
        jwtAudience: 'nimi',
      },
      runtime: {
        provider: 'llama',
        connectorId: '',
        localProviderModel: 'qwen3',
        localProviderEndpoint: 'http://127.0.0.1:11434',
        localOpenAiEndpoint: '',
        targetType: '',
        targetAccountId: '',
        agentId: '',
        worldId: '',
        userConfirmedUpload: false,
      },
    });

    expect(getTextGenerateBinding(config)).toBeNull();
    expect(window.localStorage.getItem('nimi:polyinfo:ai-config:v1')).toBeNull();
  });

  it('reports local binding as not ready when daemon is stopped', () => {
    expect(summarizeRuntimeBinding({
      source: 'local',
      connectorId: '',
      model: 'qwen3',
      modelId: 'qwen3',
      localModelId: 'qwen3',
    }, {
      running: false,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '',
      version: '',
      lastError: '',
    })).toEqual({
      title: '本地 · qwen3',
      detail: 'runtime 当前未运行',
      ready: false,
    });
  });

  it('uses available local fallback instead of a missing runtime default', () => {
    const status = resolveTextGenerateRouteStatus({
      aiConfig: loadPersistedAIConfig(),
      runtimeDefaults: {
        realm: {
          realmBaseUrl: 'https://realm.example.com',
          realtimeUrl: 'wss://realm.example.com/ws',
          accessToken: '',
          jwksUrl: 'https://realm.example.com/jwks',
          revocationUrl: 'https://realm.example.com/revoke',
          jwtIssuer: 'https://realm.example.com',
          jwtAudience: 'nimi',
        },
        runtime: {
          provider: 'llama',
          connectorId: '',
          localProviderModel: 'missing-model',
          localProviderEndpoint: 'http://127.0.0.1:11434',
          localOpenAiEndpoint: '',
          targetType: '',
          targetAccountId: '',
          agentId: '',
          worldId: '',
          userConfirmedUpload: false,
        },
      },
      routeOptions: {
        capability: 'text.generate',
        selected: null,
        resolvedDefault: {
          source: 'local',
          connectorId: '',
          model: 'qwen3',
          modelId: 'qwen3',
          localModelId: 'local-qwen3',
          goRuntimeLocalModelId: 'local-qwen3',
          goRuntimeStatus: 'installed',
        },
        local: {
          models: [{
            localModelId: 'local-qwen3',
            label: 'Qwen 3',
            model: 'qwen3',
            modelId: 'qwen3',
            provider: 'llama',
            engine: 'llama',
            goRuntimeLocalModelId: 'local-qwen3',
            goRuntimeStatus: 'installed',
            status: 'installed',
            capabilities: ['text.generate'],
          }],
        },
        connectors: [],
      },
      authStatus: 'anonymous',
    });

    expect(status).toMatchObject({
      source: 'fallback',
      blockingReason: 'none',
      ready: true,
      title: '本地 · qwen3',
    });
  });

  it('keeps an invalid explicit local selection blocked until the user changes it', () => {
    window.localStorage.setItem('nimi:polyinfo:ai-config:v1', JSON.stringify({
      scopeRef: { kind: 'app', ownerId: 'polyinfo', surfaceId: 'chat' },
      capabilities: {
        selectedBindings: {
          'text.generate': {
            source: 'local',
            connectorId: '',
            model: 'stale-model',
            modelId: 'stale-model',
            localModelId: 'stale-model',
          },
        },
      },
    }));

    const status = resolveTextGenerateRouteStatus({
      aiConfig: loadPersistedAIConfig(),
      routeOptions: {
        capability: 'text.generate',
        selected: {
          source: 'local',
          connectorId: '',
          model: 'stale-model',
          modelId: 'stale-model',
          localModelId: 'stale-model',
          goRuntimeStatus: 'unavailable',
        },
        resolvedDefault: {
          source: 'local',
          connectorId: '',
          model: 'qwen3',
          modelId: 'qwen3',
          localModelId: 'local-qwen3',
        },
        local: {
          models: [{
            localModelId: 'local-qwen3',
            label: 'Qwen 3',
            model: 'qwen3',
            modelId: 'qwen3',
            provider: 'llama',
            engine: 'llama',
            goRuntimeLocalModelId: 'local-qwen3',
            goRuntimeStatus: 'installed',
            status: 'installed',
            capabilities: ['text.generate'],
          }],
        },
        connectors: [],
      },
      authStatus: 'anonymous',
    });

    expect(status).toMatchObject({
      source: 'selected',
      blockingReason: 'local-unavailable',
      ready: false,
      title: '本地 · stale-model',
    });
  });

  it('blocks cloud routes for anonymous sessions with an explicit login prompt', () => {
    window.localStorage.setItem('nimi:polyinfo:ai-config:v1', JSON.stringify({
      scopeRef: { kind: 'app', ownerId: 'polyinfo', surfaceId: 'chat' },
      capabilities: {
        selectedBindings: {
          'text.generate': {
            source: 'cloud',
            connectorId: 'sys-cloud-dashscope',
            model: 'qwen3-max',
            modelId: 'qwen3-max',
          },
        },
      },
    }));

    const status = resolveTextGenerateRouteStatus({
      aiConfig: loadPersistedAIConfig(),
      routeOptions: {
        capability: 'text.generate',
        selected: {
          source: 'cloud',
          connectorId: 'sys-cloud-dashscope',
          model: 'qwen3-max',
          modelId: 'qwen3-max',
        },
        resolvedDefault: undefined,
        local: { models: [] },
        connectors: [{
          id: 'sys-cloud-dashscope',
          label: 'DashScope',
          provider: 'dashscope',
          vendor: 'dashscope',
          models: ['qwen3-max'],
          modelCapabilities: {},
        }],
      },
      authStatus: 'anonymous',
    });

    expect(status).toMatchObject({
      source: 'selected',
      blockingReason: 'cloud-auth-required',
      ready: false,
      title: '云端 · qwen3-max',
    });
    expect(status.detail).toContain('像 Desktop 一样复用登录态');
  });
});
