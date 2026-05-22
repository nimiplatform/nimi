import { describe, expect, it, vi } from 'vitest';
import {
  appendLocalCreativeAssetHistory,
  loadLocalCreativeAssetHistory,
} from './creative-asset-history.js';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe('local creative asset history', () => {
  it('persists app-local candidate history per agent without public truth', () => {
    const storage = createStorage();

    const next = appendLocalCreativeAssetHistory('agent-1', {
      id: 'history-1',
      createdAt: '2026-05-22T00:00:00.000Z',
      kind: 'runtime-image-candidate',
      label: 'Runtime image candidate',
      source: 'Runtime media.image.generate',
      detail: 'artifact-image-1',
      artifactIds: ['artifact-image-1'],
    }, storage);

    expect(next).toEqual([{
      id: 'history-1',
      agentId: 'agent-1',
      createdAt: '2026-05-22T00:00:00.000Z',
      kind: 'runtime-image-candidate',
      label: 'Runtime image candidate',
      source: 'Runtime media.image.generate',
      publicTruth: false,
      detail: 'artifact-image-1',
      artifactIds: ['artifact-image-1'],
    }]);
    expect(loadLocalCreativeAssetHistory('agent-1', storage)).toEqual(next);
    expect(loadLocalCreativeAssetHistory('agent-2', storage)).toEqual([]);
  });

  it('drops malformed or public-truth records when loading', () => {
    const storage = createStorage();
    storage.setItem('realm-agent-studio.creative-asset-history.agent-1', JSON.stringify([
      {
        id: 'bad-public',
        kind: 'identity-resource-upload',
        label: 'Bad public',
        createdAt: '2026-05-22T00:00:00.000Z',
        source: 'Realm ResourcesService direct upload + finalizeResource',
        detail: 'resource-1',
        publicTruth: true,
      },
      {
        id: 'good-local',
        kind: 'identity-resource-upload',
        label: 'Identity Resource upload',
        createdAt: '2026-05-22T00:00:00.000Z',
        source: 'Realm ResourcesService direct upload + finalizeResource',
        detail: 'resource-2',
        resourceId: 'resource-2',
        publicTruth: false,
      },
    ]));

    expect(loadLocalCreativeAssetHistory('agent-1', storage)).toEqual([{
      id: 'good-local',
      agentId: 'agent-1',
      kind: 'identity-resource-upload',
      label: 'Identity Resource upload',
      createdAt: '2026-05-22T00:00:00.000Z',
      source: 'Realm ResourcesService direct upload + finalizeResource',
      publicTruth: false,
      detail: 'resource-2',
      resourceId: 'resource-2',
    }]);
  });
});
