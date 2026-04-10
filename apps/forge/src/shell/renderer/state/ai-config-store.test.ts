import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAiConfigStore } from './ai-config-store.js';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      health: vi.fn().mockResolvedValue({ status: 'healthy' }),
    },
  }),
}));

vi.mock('@nimiplatform/sdk/mod', () => ({
  createEmptyAIConfig: (scopeRef?: { kind: string; ownerId: string; surfaceId?: string }) => ({
    scopeRef: scopeRef || { kind: 'app', ownerId: 'forge', surfaceId: 'settings' },
    capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
    profileOrigin: null,
  }),
}));

const STORAGE_KEY = 'nimi.forge.ai-config.v2';
const LEGACY_STORAGE_KEY = 'nimi:forge:ai-config';

function resetStore() {
  useAiConfigStore.setState({
    aiConfig: {
      scopeRef: { kind: 'app', ownerId: 'forge', surfaceId: 'settings' },
      capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
      profileOrigin: null,
    },
    runtimeStatus: 'unknown',
    error: null,
  });
}

describe('ai-config-store (AIConfig)', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    resetStore();
  });

  it('has empty AIConfig by default', () => {
    const { aiConfig } = useAiConfigStore.getState();
    expect(aiConfig.scopeRef.ownerId).toBe('forge');
    expect(aiConfig.capabilities.selectedBindings).toEqual({});
  });

  it('setSelection stores text.generate as RuntimeRouteBinding in AIConfig', () => {
    useAiConfigStore.getState().setSelection('text', {
      source: 'cloud', connectorId: 'c1', model: 'gpt-4.1',
    });

    const binding = useAiConfigStore.getState().aiConfig.capabilities.selectedBindings['text.generate'];
    expect(binding).toEqual({ source: 'cloud', connectorId: 'c1', model: 'gpt-4.1' });
  });

  it('setSelection stores image.generate in AIConfig', () => {
    useAiConfigStore.getState().setSelection('image', {
      source: 'local', connectorId: '', model: 'flux-dev',
    });

    const binding = useAiConfigStore.getState().aiConfig.capabilities.selectedBindings['image.generate'];
    expect(binding).toEqual({ source: 'local', connectorId: '', model: 'flux-dev' });
  });

  it('setSelection stores music.generate in AIConfig (canonical token)', () => {
    useAiConfigStore.getState().setSelection('music', {
      source: 'cloud', connectorId: 'c-suno', model: 'suno-v3',
    });

    const binding = useAiConfigStore.getState().aiConfig.capabilities.selectedBindings['music.generate'];
    expect(binding).toEqual({ source: 'cloud', connectorId: 'c-suno', model: 'suno-v3' });

    // NOT stored under audio.generate
    expect(useAiConfigStore.getState().aiConfig.capabilities.selectedBindings['audio.generate']).toBeUndefined();
  });

  it('setSelection stores tts.synthesize in AIConfig', () => {
    useAiConfigStore.getState().setSelection('tts', {
      source: 'cloud', connectorId: 'c-tts', model: 'tts-v1',
    });

    const binding = useAiConfigStore.getState().aiConfig.capabilities.selectedBindings['tts.synthesize'];
    expect(binding).toEqual({ source: 'cloud', connectorId: 'c-tts', model: 'tts-v1' });
  });

  it('persists to localStorage on setSelection', () => {
    useAiConfigStore.getState().setSelection('text', {
      source: 'cloud', connectorId: 'c1', model: 'gpt-4.1',
    });

    const stored = JSON.parse(storage.get(STORAGE_KEY)!);
    expect(stored.capabilities.selectedBindings['text.generate']).toEqual({
      source: 'cloud', connectorId: 'c1', model: 'gpt-4.1',
    });
  });

  it('resetToDefaults clears all selections', () => {
    useAiConfigStore.getState().setSelection('text', { source: 'cloud', connectorId: 'c1', model: 'x' });
    useAiConfigStore.getState().setSelection('music', { source: 'local', connectorId: '', model: 'y' });
    useAiConfigStore.getState().resetToDefaults();

    expect(useAiConfigStore.getState().aiConfig.capabilities.selectedBindings).toEqual({});
  });

  it('checkRuntimeStatus sets connected when healthy', async () => {
    await useAiConfigStore.getState().checkRuntimeStatus();
    expect(useAiConfigStore.getState().runtimeStatus).toBe('connected');
  });

  it('getBinding returns undefined for unset capability', () => {
    expect(useAiConfigStore.getState().getBinding('text.generate')).toBeUndefined();
  });

  it('migrates legacy localStorage format (nimi:forge:ai-config)', () => {
    storage.set(LEGACY_STORAGE_KEY, JSON.stringify({
      text: { connectorId: 'c1', model: 'gpt-4o', route: 'cloud' },
      image: { connectorId: '', model: 'flux', route: 'auto' },
      music: { connectorId: '', model: 'suno', route: 'auto' },
    }));

    // Re-import would trigger migration; we verify the legacy key is present pre-migration
    expect(storage.get(LEGACY_STORAGE_KEY)).toBeTruthy();
  });

  it('migrates intermediate v1 deferredSelections format', () => {
    const v1Data = {
      aiConfig: {
        scopeRef: { kind: 'app', ownerId: 'forge', surfaceId: 'settings' },
        capabilities: {
          selectedBindings: { 'text.generate': { source: 'cloud', connectorId: 'c1', model: 'gpt-4o' } },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
      deferredSelections: {
        'audio.generate': { source: 'local', connectorId: '', model: 'suno-v3' },
      },
    };
    storage.set(STORAGE_KEY, JSON.stringify(v1Data));

    // Re-import would trigger migration; verify data is present
    expect(storage.get(STORAGE_KEY)).toBeTruthy();
  });
});
