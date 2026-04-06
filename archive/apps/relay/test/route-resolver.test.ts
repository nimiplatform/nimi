import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelayRoute } from '../src/main/route/route-resolver.js';
import type { RelayRouteOptions } from '../src/main/route/types.js';

function createOptions(): RelayRouteOptions {
  return {
    local: {
      models: [{
        localModelId: '01LOCALASSET',
        modelId: 'nimi/local-import-qwen3-4b-q4-k-m',
        assetId: 'local-import/Qwen3-4B-Q4_K_M',
        engine: 'llama',
        status: 'installed',
        capabilities: ['text.generate'],
      }],
      status: 'ready',
    },
    connectors: [],
    selected: null,
    loadStatus: 'ready',
    issues: [],
  };
}

describe('resolveRelayRoute', () => {
  it('uses local assetId for runtime execution when localModelId matches', () => {
    const resolved = resolveRelayRoute(
      {
        source: 'local',
        model: '01LOCALASSET',
        localModelId: '01LOCALASSET',
      },
      createOptions(),
    );

    assert.deepEqual(resolved, {
      source: 'local',
      model: 'local/local-import/Qwen3-4B-Q4_K_M',
      localModelId: '01LOCALASSET',
    });
  });

  it('matches legacy binding.model against assetId as well as display modelId', () => {
    const resolved = resolveRelayRoute(
      {
        source: 'local',
        model: 'local/local-import/Qwen3-4B-Q4_K_M',
      },
      createOptions(),
    );

    assert.deepEqual(resolved, {
      source: 'local',
      model: 'local/local-import/Qwen3-4B-Q4_K_M',
      localModelId: '01LOCALASSET',
    });
  });
});
