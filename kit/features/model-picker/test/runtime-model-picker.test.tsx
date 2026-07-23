import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useRuntimeModelPicker,
  useRuntimeModelPickerPanel,
  type RuntimeCatalogModelSummary,
  type RuntimeModelCatalogService,
} from '../src/runtime.js';
import { RuntimeModelPickerPanel } from '../src/ui.js';
import { ModelPickerModal } from '../src/components/model-picker-modal.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

const models: RuntimeCatalogModelSummary[] = [
  {
    provider: 'acme',
    modelId: 'acme/text-fast',
    modelType: 'text',
    updatedAt: '2026-03-24',
    capabilities: ['text.generate'],
    source: 'builtin',
    userScoped: false,
    sourceNote: 'Fast text model',
    hasVoiceCatalog: false,
    hasVideoGeneration: false,
  },
  {
    provider: 'acme',
    modelId: 'acme/video-pro',
    modelType: 'video',
    updatedAt: '2026-03-24',
    capabilities: ['video.generate'],
    source: 'custom',
    userScoped: true,
    sourceNote: 'Video generation model',
    hasVoiceCatalog: false,
    hasVideoGeneration: true,
  },
];

const service: RuntimeModelCatalogService = {
  listProviders: async () => [],
  listProviderModels: async () => ({
    provider: {
      provider: 'acme',
      version: 1,
      catalogVersion: 'v1',
      source: 'builtin',
      inventoryMode: 'static_source',
      modelCount: 2,
      voiceCount: 0,
      defaultTextModel: 'acme/text-fast',
      capabilities: ['text.generate', 'video.generate'],
      hasOverlay: false,
      customModelCount: 1,
      overriddenModelCount: 0,
      overlayUpdatedAt: '',
      yaml: '',
      effectiveYaml: '',
      defaultEndpoint: '',
      requiresExplicitEndpoint: false,
      runtimePlane: 'remote',
      executionModule: 'nimillm',
      managedSupported: true,
    },
    models,
    nextPageToken: '',
    warnings: [],
  }),
  getModelDetail: async () => ({
    provider: {
      provider: 'acme',
      version: 1,
      catalogVersion: 'v1',
      source: 'builtin',
      inventoryMode: 'static_source',
      modelCount: 2,
      voiceCount: 0,
      defaultTextModel: 'acme/text-fast',
      capabilities: ['text.generate', 'video.generate'],
      hasOverlay: false,
      customModelCount: 1,
      overriddenModelCount: 0,
      overlayUpdatedAt: '',
      yaml: '',
      effectiveYaml: '',
      defaultEndpoint: '',
      requiresExplicitEndpoint: false,
      runtimePlane: 'remote',
      executionModule: 'nimillm',
      managedSupported: true,
    },
    model: {
      ...models[0],
      pricing: {
        unit: 'token',
        input: '1',
        output: '2',
        currency: 'USD',
        asOf: '2026-03-24',
        notes: 'test',
      },
      voiceSetId: '',
      voiceDiscoveryMode: '',
      voiceRefKinds: [],
      videoGeneration: null,
      sourceRef: {
        url: 'https://example.com',
        retrievedAt: '2026-03-24',
        note: '',
      },
      warnings: [],
      voices: [],
      voiceWorkflowModels: [],
      modelWorkflowBinding: null,
    },
    warnings: [],
  }),
};

function Harness() {
  const state = useRuntimeModelPicker({
    provider: 'acme',
    service,
  });

  return (
    <div>
      <div data-testid="count">{state.filteredModels.length}</div>
      <div data-testid="selected">{state.selectedModel?.modelId || ''}</div>
      <div data-testid="groups">{state.groupedModels.map((group) => group.label).join(', ')}</div>
      <div data-testid="badges">{(state.selectedModel ? state.adapter.getBadges?.(state.selectedModel) : [])?.map((badge) => badge.label).join(', ')}</div>
    </div>
  );
}

function PanelHarness() {
  const state = useRuntimeModelPickerPanel({
    provider: 'acme',
    service,
  });

  return (
    <RuntimeModelPickerPanel
      state={state}
      renderDetailActions={(model) => <button type="button">Use {model.modelId}</button>}
    />
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe('useRuntimeModelPicker', () => {
  it('loads runtime models through the injected service and applies default adapter mapping', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness />);
      await flush();
      await flush();
    });

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('acme/text-fast');
    expect(container.querySelector('[data-testid="groups"]')?.textContent).toContain('Builtin (1)');
    expect(container.querySelector('[data-testid="groups"]')?.textContent).toContain('Custom (1)');
    expect(container.querySelector('[data-testid="badges"]')?.textContent).toContain('text');
  });

  it('loads selected model detail into the default runtime panel', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<PanelHarness />);
      await flush();
      await flush();
    });

    expect(container.textContent).toContain('acme/text-fast');
    expect(container.textContent).toContain('Fast text model');
    expect(container.textContent).toContain('Pricing');
    expect(container.textContent).toContain('Use acme/text-fast');
  });
});

describe('ModelPickerModal', () => {
  it('exposes unique ready and unavailable selectors from authoritative local readiness', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ModelPickerModal
          open
          onClose={() => undefined}
          capability="text.generate"
          capabilityLabel="Chat"
          provider={{
            listLocalModels: async () => [{
              localModelId: 'ready-local-chat',
              modelId: 'local-import/ready-chat',
              label: 'ready-chat',
              engine: 'llama',
              status: 'active',
              capabilities: ['text.generate'],
            }, {
              localModelId: 'unavailable-local-chat',
              modelId: 'local-import/unavailable-chat',
              label: 'unavailable-chat',
              engine: 'llama',
              status: 'unhealthy',
              capabilities: ['text.generate'],
            }],
            listConnectors: async () => [],
            listConnectorModels: async () => [],
          }}
          onSelect={() => undefined}
        />,
      );
      await flush();
      await flush();
    });

    const ready = document.body.querySelector('[data-testid="model-picker-option:local-ready"]');
    const unavailable = document.body.querySelector('[data-testid="model-picker-option:local-unavailable"]');
    expect(ready?.getAttribute('data-nimi-route-source')).toBe('local');
    expect(ready?.getAttribute('data-nimi-route-readiness')).toBe('active');
    expect(ready?.getAttribute('data-nimi-local-model-id')).toBe('ready-local-chat');
    expect(unavailable?.getAttribute('data-nimi-route-source')).toBe('local');
    expect(unavailable?.getAttribute('data-nimi-route-readiness')).toBe('unhealthy');
    expect(unavailable?.getAttribute('data-nimi-local-model-id')).toBe('unavailable-local-chat');
  });

  it('preserves the v2 local target ref when selecting a local runtime model', async () => {
    const onSelect = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ModelPickerModal
          open
          onClose={() => undefined}
          capability="text.generate"
          capabilityLabel="Chat"
          provider={{
            listLocalModels: async () => [{
              localModelId: 'desktop-local-chat',
              goRuntimeLocalModelId: 'go-runtime-local-chat',
              profileBindingId: 'runtime-profile:desktop-local-chat',
              modelId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
              label: 'gemma-4-26B-A4B-it-Q8_0',
              engine: 'llama',
              status: 'active',
              capabilities: ['text.generate'],
            }],
            listConnectors: async () => [],
            listConnectorModels: async () => [],
          }}
          onSelect={onSelect}
        />,
      );
      await flush();
      await flush();
    });

    const option = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('gemma-4-26B-A4B-it-Q8_0'));
    expect(option).toBeTruthy();

    await act(async () => {
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      source: 'local',
      model: 'desktop-local-chat',
      localModelId: 'desktop-local-chat',
      goRuntimeLocalModelId: 'go-runtime-local-chat',
      profileBindingId: 'runtime-profile:desktop-local-chat',
      modelId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
      engine: 'llama',
    }));
  });

  it('preserves v2 cloud connector target fields when selecting a connector model', async () => {
    const onSelect = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ModelPickerModal
          open
          onClose={() => undefined}
          capability="video.generate"
          capabilityLabel="Video generation"
          initialSelection={{ source: 'cloud', connectorId: 'volcengine' }}
          provider={{
            listLocalModels: async () => [],
            listConnectors: async () => [{
              connectorId: 'volcengine',
              provider: 'volcengine',
              label: 'volcengine',
              status: 'active',
            }],
            listConnectorModels: async (connectorId) => connectorId === 'volcengine'
              ? [{
                modelId: 'seedance-2.0',
                remoteModelCatalogId: 'remote-catalog:volcengine:seedance-2.0',
                providerModelId: 'seedance-2.0',
                provider: 'volcengine',
                modelLabel: 'seedance-2.0',
                available: true,
                capabilities: ['video.generate'],
              }]
              : [],
          }}
          onSelect={onSelect}
        />,
      );
      await flush();
      await flush();
      await flush();
    });

    const option = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('seedance-2.0'));
    expect(option).toBeTruthy();

    await act(async () => {
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloud',
      connectorId: 'volcengine',
      model: 'seedance-2.0',
      provider: 'volcengine',
      remoteModelCatalogId: 'remote-catalog:volcengine:seedance-2.0',
      providerModelId: 'seedance-2.0',
      modelLabel: 'seedance-2.0',
    }));
  });

  it('renders host-provided modal copy for localized desktop shells', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ModelPickerModal
          open
          onClose={() => undefined}
          capability="text.generate"
          capabilityLabel="文本生成"
          copy={{
            title: '选择模型',
            local: '本地',
            cloud: '云端',
            selectConnectorLabel: '选择连接器',
            searchPlaceholder: '搜索模型',
            loading: '正在加载模型...',
            noSearchResults: '没有匹配的模型。',
            noModelsAvailable: '没有可用模型。',
          }}
          provider={{
            listLocalModels: async () => [{
              localModelId: 'local-chat',
              modelId: 'local-import/chat-model',
              label: 'chat-model',
              engine: 'llama',
              status: 'active',
              capabilities: ['text.generate'],
            }],
            listConnectors: async () => [],
            listConnectorModels: async () => [],
          }}
          onSelect={() => undefined}
        />,
      );
      await flush();
      await flush();
    });

    expect(document.body.textContent).toContain('选择模型');
    expect(document.body.textContent).toContain('本地');
    expect(document.body.textContent).toContain('云端');
    expect(document.body.textContent).not.toContain('Select Model');
    expect(document.body.querySelector('input')?.getAttribute('placeholder')).toBe('搜索模型');

    const searchInput = document.body.querySelector('input');
    expect(searchInput).toBeTruthy();
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      if (searchInput) {
        valueSetter?.call(searchInput, 'missing');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await flush();
      await flush();
    });

    expect(document.body.textContent).toContain('没有匹配的模型。');
    expect(document.body.textContent).not.toContain('No models match your search.');
  });
});
