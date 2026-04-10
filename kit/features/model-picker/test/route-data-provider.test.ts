import { describe, expect, it } from 'vitest';
import {
  createSnapshotRouteDataProvider,
  type RouteOptionsSnapshot,
} from '../src/route-data.js';

// ---------------------------------------------------------------------------
// createSnapshotRouteDataProvider
// ---------------------------------------------------------------------------

function makeSnapshot(overrides?: Partial<RouteOptionsSnapshot>): RouteOptionsSnapshot {
  return {
    capability: 'text.generate',
    selected: null,
    local: {
      models: [],
      defaultEndpoint: 'http://127.0.0.1:11434/v1',
    },
    connectors: [],
    ...overrides,
  };
}

describe('createSnapshotRouteDataProvider', () => {
  it('maps snapshot local models to RouteLocalModel list', async () => {
    const snapshot = makeSnapshot({
      local: {
        models: [
          {
            localModelId: 'local-qwen',
            model: 'qwen3',
            modelId: 'qwen3',
            engine: 'llama',
            provider: 'llama',
            status: 'active',
            capabilities: ['chat'],
          },
          {
            localModelId: 'local-flux',
            model: 'flux',
            modelId: 'flux',
            engine: 'media',
            provider: 'media',
            status: 'installed',
            capabilities: ['image'],
          },
        ],
      },
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const models = await provider.listLocalModels();

    expect(models).toHaveLength(2);
    // active sorts before installed
    expect(models[0]!.localModelId).toBe('local-qwen');
    expect(models[0]!.status).toBe('active');
    expect(models[1]!.localModelId).toBe('local-flux');
    expect(models[1]!.status).toBe('installed');
  });

  it('maps snapshot connectors to RouteConnector list (cloud only)', async () => {
    const snapshot = makeSnapshot({
      connectors: [
        {
          id: 'connector-openai',
          label: 'OpenAI',
          provider: 'openai',
          models: ['gpt-4.1', 'gpt-4.1-mini'],
          modelCapabilities: {
            'gpt-4.1': ['chat'],
            'gpt-4.1-mini': ['chat'],
          },
        },
        {
          id: 'connector-anthropic',
          label: 'Anthropic',
          provider: 'anthropic',
          models: ['claude-sonnet-4-6'],
        },
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const connectors = await provider.listConnectors();

    expect(connectors).toHaveLength(2);
    expect(connectors.map((c) => c.connectorId)).toEqual([
      'connector-openai',
      'connector-anthropic',
    ]);
  });

  it('returns connector models from inline snapshot data', async () => {
    const snapshot = makeSnapshot({
      connectors: [
        {
          id: 'connector-openai',
          label: 'OpenAI',
          provider: 'openai',
          models: ['gpt-4.1', 'gpt-4.1-mini'],
          modelCapabilities: {
            'gpt-4.1': ['chat'],
            'gpt-4.1-mini': ['chat'],
          },
        },
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const models = await provider.listConnectorModels('connector-openai');

    expect(models).toHaveLength(2);
    expect(models.map((m) => m.modelId)).toEqual(['gpt-4.1', 'gpt-4.1-mini']);
    expect(models[0]!.available).toBe(true);
    expect(models[0]!.capabilities).toEqual(['chat']);
  });

  it('returns empty list for unknown connector id', async () => {
    const snapshot = makeSnapshot({
      connectors: [
        { id: 'connector-openai', label: 'OpenAI', provider: 'openai', models: ['gpt-4.1'] },
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const models = await provider.listConnectorModels('nonexistent');

    expect(models).toHaveLength(0);
  });

  it('excludes connectors with zero models', async () => {
    const snapshot = makeSnapshot({
      connectors: [
        { id: 'empty-connector', label: 'Empty', provider: 'empty', models: [] },
        { id: 'real-connector', label: 'Real', provider: 'real', models: ['model-1'] },
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const connectors = await provider.listConnectors();

    expect(connectors).toHaveLength(1);
    expect(connectors[0]!.connectorId).toBe('real-connector');
  });

  it('fetches snapshot only once per cycle (caches across concurrent calls)', async () => {
    let fetchCount = 0;
    const snapshot = makeSnapshot({
      local: { models: [{ localModelId: 'a', model: 'a', status: 'active' }] },
      connectors: [{ id: 'c', label: 'C', provider: 'p', models: ['m'] }],
    });

    const provider = createSnapshotRouteDataProvider(async () => {
      fetchCount += 1;
      return snapshot;
    });

    // Call all three methods concurrently
    const [localModels, connectors, connectorModels] = await Promise.all([
      provider.listLocalModels(),
      provider.listConnectors(),
      provider.listConnectorModels('c'),
    ]);

    expect(fetchCount).toBe(1);
    expect(localModels).toHaveLength(1);
    expect(connectors).toHaveLength(1);
    expect(connectorModels).toHaveLength(1);
  });

  it('reuses the cached snapshot across sequential reads until invalidated', async () => {
    let fetchCount = 0;
    const provider = createSnapshotRouteDataProvider(async () => {
      fetchCount += 1;
      return makeSnapshot({
        connectors: [{ id: 'c', label: 'C', provider: 'p', models: ['m'] }],
      });
    });

    await provider.listLocalModels();
    await provider.listConnectors();
    await provider.listConnectorModels('c');

    expect(fetchCount).toBe(1);

    provider.invalidate?.();
    await provider.listConnectors();

    expect(fetchCount).toBe(2);
  });

  it('does not cache a failed snapshot fetch forever', async () => {
    let fetchCount = 0;
    const provider = createSnapshotRouteDataProvider(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        throw new Error('temporary route failure');
      }
      return makeSnapshot({
        connectors: [{ id: 'c', label: 'C', provider: 'p', models: ['m'] }],
      });
    });

    await expect(provider.listConnectors()).rejects.toThrow('temporary route failure');
    const connectors = await provider.listConnectors();

    expect(fetchCount).toBe(2);
    expect(connectors).toHaveLength(1);
  });
});
