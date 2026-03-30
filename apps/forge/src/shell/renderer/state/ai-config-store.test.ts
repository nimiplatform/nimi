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
      health: vi.fn().mockResolvedValue({ status: 'healthy' }),
    },
  }),
}));

const STORAGE_KEY = 'nimi:forge:ai-config';

describe('ai-config-store', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    useAiConfigStore.setState({
      selections: {
        text: { connectorId: '', model: 'auto', route: 'auto' },
        image: { connectorId: '', model: 'auto', route: 'auto' },
        music: { connectorId: '', model: 'auto', route: 'auto' },
      },
      runtimeStatus: 'unknown',
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

  it('checkRuntimeStatus sets connected when healthy', async () => {
    await useAiConfigStore.getState().checkRuntimeStatus();
    expect(useAiConfigStore.getState().runtimeStatus).toBe('connected');
  });
});
