import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentAssetOpsStore } from './agent-asset-ops-store.js';

const storage = new Map<string, string>();

describe('agent-asset-ops-store', () => {
  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    useAgentAssetOpsStore.setState((state) => ({ ...state, profiles: {} }));
  });

  it('allows adopting a current avatar candidate without a resource id', () => {
    const candidate = useAgentAssetOpsStore.getState().enqueueCandidate({
      userId: 'user-1',
      agentId: 'agent-1',
      family: 'agent-avatar',
      kind: 'resource',
      previewUrl: 'https://cdn.example.com/ari-avatar.png',
      origin: 'manual',
      lifecycle: 'confirmed',
    });

    expect(candidate.resourceId).toBeNull();
    expect(candidate.previewUrl).toBe('https://cdn.example.com/ari-avatar.png');
    expect(candidate.lifecycle).toBe('confirmed');
  });

  it('dedupes repeated current-avatar adoption by preview url', () => {
    useAgentAssetOpsStore.getState().enqueueCandidate({
      userId: 'user-1',
      agentId: 'agent-1',
      family: 'agent-avatar',
      kind: 'resource',
      previewUrl: 'https://cdn.example.com/ari-avatar.png',
      origin: 'manual',
      lifecycle: 'confirmed',
    });
    useAgentAssetOpsStore.getState().enqueueCandidate({
      userId: 'user-1',
      agentId: 'agent-1',
      family: 'agent-avatar',
      kind: 'resource',
      previewUrl: 'https://cdn.example.com/ari-avatar.png',
      origin: 'manual',
      lifecycle: 'confirmed',
    });

    const candidates = useAgentAssetOpsStore.getState().profiles['user-1']?.candidates ?? [];
    expect(candidates).toHaveLength(1);
  });
});
