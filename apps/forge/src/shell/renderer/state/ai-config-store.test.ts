import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAiConfigStore } from './ai-config-store.js';

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

// Mock getPlatformClient
vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      connector: {
        listConnectors: vi.fn().mockResolvedValue({
          connectors: [
            { connectorId: 'c1', provider: 'openai', label: 'OpenAI', status: 1 },
            { connectorId: 'c2', provider: 'deepseek', label: 'DeepSeek', status: 1 },
          ],
          nextPageToken: '',
        }),
        listConnectorModels: vi.fn().mockResolvedValue({
          models: [
            { modelId: 'gpt-4o', modelLabel: 'GPT-4o', available: true, capabilities: ['text'] },
            { modelId: 'gpt-4o-mini', modelLabel: 'GPT-4o mini', available: true, capabilities: ['text'] },
          ],
          nextPageToken: '',
        }),
        testConnector: vi.fn().mockResolvedValue({ ack: {} }),
      },
      health: vi.fn().mockResolvedValue({ status: 'healthy' }),
    },
  }),
}));

const STORAGE_KEY = 'nimi:forge:ai-config';

describe('ai-config-store', () => {
  beforeEach(() => {
    storage.clear();
    // Reset store to defaults
    useAiConfigStore.setState({
      selections: {
        text: { connectorId: '', model: 'auto', route: 'auto' },
        image: { connectorId: '', model: 'auto', route: 'auto' },
        music: { connectorId: '', model: 'auto', route: 'auto' },
      },
      runtimeStatus: 'unknown',
      connectors: [],
      connectorModels: {},
      loading: false,
      error: null,
    });
  });

  it('has correct default selections', () => {
    const { selections } = useAiConfigStore.getState();
    expect(selections.text).toEqual({ connectorId: '', model: 'auto', route: 'auto' });
    expect(selections.image).toEqual({ connectorId: '', model: 'auto', route: 'auto' });
    expect(selections.music).toEqual({ connectorId: '', model: 'auto', route: 'auto' });
  });

  it('setSelection updates a single capability and persists', () => {
    useAiConfigStore.getState().setSelection('text', { connectorId: 'c1', model: 'gpt-4o' });

    const { selections } = useAiConfigStore.getState();
    expect(selections.text.connectorId).toBe('c1');
    expect(selections.text.model).toBe('gpt-4o');
    expect(selections.text.route).toBe('auto'); // unchanged

    // Other capabilities untouched
    expect(selections.image.connectorId).toBe('');
    expect(selections.music.connectorId).toBe('');

    // Persisted to localStorage
    const stored = JSON.parse(storage.get(STORAGE_KEY)!);
    expect(stored.text.connectorId).toBe('c1');
  });

  it('resetToDefaults clears all selections', () => {
    useAiConfigStore.getState().setSelection('image', { connectorId: 'c2', model: 'flux', route: 'cloud' });
    useAiConfigStore.getState().resetToDefaults();

    const { selections } = useAiConfigStore.getState();
    expect(selections.image).toEqual({ connectorId: '', model: 'auto', route: 'auto' });
  });

  it('fetchConnectors populates connector list', async () => {
    await useAiConfigStore.getState().fetchConnectors();

    const { connectors, loading } = useAiConfigStore.getState();
    const firstConnector = connectors[0];
    const secondConnector = connectors[1];
    expect(loading).toBe(false);
    expect(connectors).toHaveLength(2);
    expect(firstConnector).toBeDefined();
    expect(secondConnector).toBeDefined();
    expect(firstConnector?.connectorId).toBe('c1');
    expect(secondConnector?.provider).toBe('deepseek');
  });

  it('fetchConnectorModels populates models for a connector', async () => {
    await useAiConfigStore.getState().fetchConnectorModels('c1');

    const { connectorModels } = useAiConfigStore.getState();
    const firstModel = connectorModels['c1']?.[0];
    expect(connectorModels['c1']).toHaveLength(2);
    expect(firstModel).toBeDefined();
    expect(firstModel?.modelId).toBe('gpt-4o');
  });

  it('testConnector returns success', async () => {
    const result = await useAiConfigStore.getState().testConnector('c1');
    expect(result.success).toBe(true);
  });

  it('checkRuntimeStatus sets connected when healthy', async () => {
    await useAiConfigStore.getState().checkRuntimeStatus();
    expect(useAiConfigStore.getState().runtimeStatus).toBe('connected');
  });
});
