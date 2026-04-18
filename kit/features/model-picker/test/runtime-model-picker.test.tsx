import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  useRuntimeModelPicker,
  useRuntimeModelPickerPanel,
  type RuntimeCatalogModelSummary,
  type RuntimeModelCatalogService,
} from '../src/runtime.js';
import { RuntimeModelPickerPanel } from '../src/ui.js';

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
