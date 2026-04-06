import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelayRouteBindingForModelChange,
  deriveRelayRouteDisplayState,
} from '../src/renderer/features/model-config/relay-route-binding.js';

const ROUTE_OPTIONS = {
  local: {
    models: [
      {
        localModelId: '01JLOCALMODEL',
        modelId: 'qwen2.5',
        engine: 'llama',
        status: 'active',
        capabilities: ['text.generate'],
      },
      {
        localModelId: '01JNEWLOCALMODEL',
        modelId: 'qwen3',
        engine: 'llama',
        status: 'installed',
        capabilities: ['text.generate'],
      },
    ],
  },
  connectors: [
    {
      connectorId: 'conn-openai',
      provider: 'openai',
      label: 'OpenAI',
      status: 'ready',
      models: [
        {
          modelId: 'gpt-4o-mini',
          modelLabel: 'GPT-4o Mini',
          available: true,
          capabilities: ['text.generate'],
        },
        {
          modelId: 'gpt-5-mini',
          modelLabel: 'GPT-5 Mini',
          available: true,
          capabilities: ['text.generate'],
        },
      ],
    },
  ],
  selected: null,
} as const;

describe('buildRelayRouteBindingForModelChange', () => {
  it('uses snapshot cloud route when no explicit binding exists', () => {
    const result = buildRelayRouteBindingForModelChange(
      null,
      {
        source: 'cloud',
        model: 'openai/gpt-4o-mini',
        connectorId: 'conn-openai',
        provider: 'openai',
      },
      'gpt-5-mini',
    );

    assert.deepEqual(result, {
      source: 'cloud',
      connectorId: 'conn-openai',
      model: 'gpt-5-mini',
    });
  });

  it('strips the provider prefix from fully-qualified cloud input', () => {
    const result = buildRelayRouteBindingForModelChange(
      {
        source: 'cloud',
        connectorId: 'conn-openai',
      },
      {
        source: 'cloud',
        model: 'openai/gpt-4o-mini',
        connectorId: 'conn-openai',
        provider: 'openai',
      },
      'openai/gpt-5-mini',
    );

    assert.deepEqual(result, {
      source: 'cloud',
      connectorId: 'conn-openai',
      model: 'gpt-5-mini',
    });
  });

  it('keeps local model ids when the renderer provides an unqualified local selection', () => {
    const result = buildRelayRouteBindingForModelChange(
      {
        source: 'local',
      },
      {
        source: 'local',
        model: 'local/qwen2.5',
        localModelId: '01JLOCALMODEL',
      },
      'qwen3',
      ROUTE_OPTIONS,
    );

    assert.deepEqual(result, {
      source: 'local',
      model: 'qwen3',
      localModelId: '01JNEWLOCALMODEL',
    });
  });

  it('does not mis-store a qualified local model as localModelId', () => {
    const result = buildRelayRouteBindingForModelChange(
      {
        source: 'local',
      },
      {
        source: 'local',
        model: 'local/qwen2.5',
        localModelId: '01JLOCALMODEL',
      },
      'local/qwen3',
      ROUTE_OPTIONS,
    );

    assert.deepEqual(result, {
      source: 'local',
      model: 'qwen3',
      localModelId: '01JNEWLOCALMODEL',
    });
  });
});

describe('deriveRelayRouteDisplayState', () => {
  it('shows the effective fallback route when a saved cloud binding is stale', () => {
    const result = deriveRelayRouteDisplayState(
      {
        source: 'cloud',
        connectorId: 'missing-connector',
        model: 'gpt-4o-mini',
      },
      {
        source: 'local',
        model: 'local/qwen2.5',
        localModelId: '01JLOCALMODEL',
      },
      ROUTE_OPTIONS,
    );

    assert.equal(result.source, 'local');
    assert.equal(result.model, 'qwen2.5');
    assert.equal(result.invalidBinding, true);
  });

  it('uses unqualified cloud model ids for input display', () => {
    const result = deriveRelayRouteDisplayState(
      {
        source: 'cloud',
        connectorId: 'conn-openai',
        model: 'gpt-5-mini',
      },
      {
        source: 'cloud',
        model: 'openai/gpt-5-mini',
        connectorId: 'conn-openai',
        provider: 'openai',
      },
      ROUTE_OPTIONS,
    );

    assert.equal(result.source, 'cloud');
    assert.equal(result.connectorId, 'conn-openai');
    assert.equal(result.model, 'gpt-5-mini');
    assert.equal(result.invalidBinding, false);
  });
});
