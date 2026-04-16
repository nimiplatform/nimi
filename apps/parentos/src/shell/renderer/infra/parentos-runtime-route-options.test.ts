import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../app-shell/app-store.js';

const listLocalAssetsMock = vi.fn();
const listConnectorsMock = vi.fn();
const listConnectorModelsMock = vi.fn();
const logRendererEventMock = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      local: {
        listLocalAssets: listLocalAssetsMock,
      },
    },
    domains: {
      runtimeAdmin: {
        listConnectors: listConnectorsMock,
        listConnectorModels: listConnectorModelsMock,
      },
    },
  }),
}));

vi.mock('./telemetry/renderer-log.js', () => ({
  describeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error || '') }),
  logRendererEvent: logRendererEventMock,
}));

const { loadParentosRuntimeRouteOptions } = await import('./parentos-runtime-route-options.js');

describe('parentos-runtime-route-options', () => {
  beforeEach(() => {
    listLocalAssetsMock.mockReset();
    listConnectorsMock.mockReset();
    listConnectorModelsMock.mockReset();
    logRendererEventMock.mockReset();
    listConnectorsMock.mockResolvedValue({
      connectors: [],
    });
    listConnectorModelsMock.mockResolvedValue({
      models: [],
      nextPageToken: '',
    });
    useAppStore.setState({
      runtimeDefaults: {
        webBaseUrl: '',
        realm: {
          realmBaseUrl: 'http://localhost:3002',
          realtimeUrl: '',
          accessToken: '',
          jwksUrl: 'http://localhost:3002/api/auth/jwks',
          revocationUrl: 'http://localhost:3002/api/auth/revocation',
          jwtIssuer: 'http://localhost:3002',
          jwtAudience: 'nimi-runtime',
        },
        runtime: {
          localProviderEndpoint: 'http://127.0.0.1:1234/v1',
          localProviderModel: '',
          localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
          connectorId: '',
          targetType: '',
          targetAccountId: '',
          agentId: '',
          worldId: '',
          provider: '',
          userConfirmedUpload: false,
        },
      },
      aiConfig: null,
    });
  });

  it('builds a text.generate snapshot from authoritative runtime/local sources', async () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: { kind: 'app', ownerId: 'app.nimi.parentos', surfaceId: 'settings.ai' },
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'local',
              connectorId: '',
              model: 'qwen3',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });
    listLocalAssetsMock.mockResolvedValue({
      assets: [{
        localAssetId: 'local-qwen',
        assetId: 'qwen3',
        engine: 'llama',
        status: 'active',
        endpoint: 'http://127.0.0.1:1234/v1',
        capabilities: ['chat'],
      }],
      nextPageToken: '',
    });
    const snapshot = await loadParentosRuntimeRouteOptions('text.generate');

    expect(snapshot).toEqual({
      capability: 'text.generate',
      selected: {
        source: 'local',
        connectorId: '',
        model: 'qwen3',
        modelId: 'qwen3',
        localModelId: 'local-qwen',
        provider: 'llama',
        engine: 'llama',
        endpoint: 'http://127.0.0.1:1234/v1',
        goRuntimeLocalModelId: 'local-qwen',
        goRuntimeStatus: 'active',
      },
      resolvedDefault: {
        source: 'local',
        connectorId: '',
        model: 'qwen3',
        modelId: 'qwen3',
        localModelId: 'local-qwen',
        provider: 'llama',
        engine: 'llama',
        endpoint: 'http://127.0.0.1:1234/v1',
        goRuntimeLocalModelId: 'local-qwen',
        goRuntimeStatus: 'active',
      },
      local: {
        defaultEndpoint: 'http://127.0.0.1:1234/v1',
        models: [{
          localModelId: 'local-qwen',
          label: 'qwen3',
          engine: 'llama',
          model: 'qwen3',
          modelId: 'qwen3',
          provider: 'llama',
          endpoint: 'http://127.0.0.1:1234/v1',
          status: 'active',
          goRuntimeLocalModelId: 'local-qwen',
          goRuntimeStatus: 'active',
          capabilities: ['text.generate'],
        }],
      },
      connectors: [],
    });
  });

  it('does not fabricate options when runtime exposes no matching assets or connectors', async () => {
    listLocalAssetsMock.mockResolvedValue({
      assets: [],
      nextPageToken: '',
    });
    const snapshot = await loadParentosRuntimeRouteOptions('audio.transcribe');

    expect(snapshot).toEqual({
      capability: 'audio.transcribe',
      selected: null,
      resolvedDefault: undefined,
      local: {
        defaultEndpoint: 'http://127.0.0.1:1234/v1',
        models: [],
      },
      connectors: [],
    });
  });

  it('maps numeric local asset kinds to capability-compatible local models', async () => {
    listLocalAssetsMock.mockResolvedValue({
      assets: [{
        localAssetId: 'local-gemma',
        assetId: 'gemma-4-26b-a4b-it-q8_0',
        logicalModelId: 'gemma-4-26B-A4B-it-Q8_0',
        engine: 'llama',
        status: 2,
        kind: 1,
      }],
      nextPageToken: '',
    });
    const snapshot = await loadParentosRuntimeRouteOptions('text.generate');

    expect(snapshot.local.models).toEqual([{
      localModelId: 'local-gemma',
      label: 'gemma-4-26B-A4B-it-Q8_0',
      engine: 'llama',
      model: 'gemma-4-26b-a4b-it-q8_0',
      modelId: 'gemma-4-26b-a4b-it-q8_0',
      provider: 'llama',
      endpoint: undefined,
      status: 'active',
      goRuntimeLocalModelId: 'local-gemma',
      goRuntimeStatus: 'active',
      capabilities: ['text.generate'],
    }]);
    expect(snapshot.resolvedDefault).toEqual({
      source: 'local',
      connectorId: '',
      model: 'gemma-4-26b-a4b-it-q8_0',
      modelId: 'gemma-4-26b-a4b-it-q8_0',
      localModelId: 'local-gemma',
      provider: 'llama',
      engine: 'llama',
      endpoint: undefined,
      goRuntimeLocalModelId: 'local-gemma',
      goRuntimeStatus: 'active',
    });
  });

  it('includes cloud connector options and preserves selected cloud bindings', async () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: { kind: 'app', ownerId: 'app.nimi.parentos', surfaceId: 'settings.ai' },
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'cloud',
              connectorId: 'openai-main',
              model: 'gpt-5.4',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });
    listConnectorsMock.mockResolvedValue({
      connectors: [{
        connectorId: 'openai-main',
        label: 'OpenAI',
        provider: 'openai',
        kind: 2,
      }],
    });
    listConnectorModelsMock.mockResolvedValue({
      models: [{
        available: true,
        modelId: 'gpt-5.4',
        capabilities: ['text.generate'],
      }],
      nextPageToken: '',
    });

    const snapshot = await loadParentosRuntimeRouteOptions('text.generate');

    expect(snapshot.selected).toEqual({
      source: 'cloud',
      connectorId: 'openai-main',
      model: 'gpt-5.4',
      provider: 'openai',
    });
    expect(snapshot.connectors).toEqual([{
      id: 'openai-main',
      label: 'OpenAI',
      provider: 'openai',
      models: ['gpt-5.4'],
      modelCapabilities: {
        'gpt-5.4': ['text.generate'],
      },
      modelProfiles: [],
    }]);
  });

  it('preserves multimodal text capability hints for local and cloud OCR routing', async () => {
    listLocalAssetsMock.mockResolvedValue({
      assets: [{
        localAssetId: 'local-gemma-vision',
        assetId: 'gemma-4-vision',
        logicalModelId: 'gemma-4-vision',
        engine: 'llama',
        status: 'active',
        kind: 1,
        capabilities: ['text.generate.vision'],
      }],
      nextPageToken: '',
    });
    listConnectorsMock.mockResolvedValue({
      connectors: [{
        connectorId: 'openai-main',
        label: 'OpenAI',
        provider: 'openai',
        kind: 2,
      }],
    });
    listConnectorModelsMock.mockResolvedValue({
      models: [{
        available: true,
        modelId: 'gpt-5.4',
        capabilities: ['vision'],
      }],
      nextPageToken: '',
    });

    const snapshot = await loadParentosRuntimeRouteOptions('text.generate');

    expect(snapshot.local.models[0]?.capabilities).toEqual(['text.generate.vision', 'text.generate']);
    expect(snapshot.connectors[0]?.modelCapabilities).toEqual({
      'gpt-5.4': ['text.generate.vision', 'text.generate'],
    });
  });

  it('loads a dedicated vision snapshot from the standalone OCR binding', async () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: { kind: 'app', ownerId: 'app.nimi.parentos', surfaceId: 'settings.ai' },
        capabilities: {
          selectedBindings: {
            'text.generate.vision': {
              source: 'cloud',
              connectorId: 'vision-main',
              model: 'gpt-5.4-vision',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });
    listLocalAssetsMock.mockResolvedValue({
      assets: [{
        localAssetId: 'local-gemma-vision',
        assetId: 'gemma-4-vision',
        logicalModelId: 'gemma-4-vision',
        engine: 'llama',
        status: 'active',
        kind: 1,
        capabilities: ['text.generate.vision'],
      }],
      nextPageToken: '',
    });
    listConnectorsMock.mockResolvedValue({
      connectors: [{
        connectorId: 'vision-main',
        label: 'OpenAI',
        provider: 'openai',
        kind: 2,
      }],
    });
    listConnectorModelsMock.mockResolvedValue({
      models: [{
        available: true,
        modelId: 'gpt-5.4-vision',
        capabilities: ['vision'],
      }],
      nextPageToken: '',
    });

    const snapshot = await loadParentosRuntimeRouteOptions('text.generate.vision');

    expect(snapshot.capability).toBe('text.generate');
    expect(snapshot.selected).toEqual({
      source: 'cloud',
      connectorId: 'vision-main',
      model: 'gpt-5.4-vision',
      provider: 'openai',
    });
    expect(snapshot.local.models).toHaveLength(1);
    expect(snapshot.local.models[0]?.capabilities).toEqual(['text.generate.vision', 'text.generate']);
    expect(snapshot.connectors[0]?.models).toEqual(['gpt-5.4-vision']);
  });
});
