import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMediaRouteDisplayState } from '../src/renderer/features/model-config/media-route-state.js';

const CONNECTORS = [
  {
    connectorId: 'openai-primary',
    provider: 'openai',
    label: 'OpenAI',
    status: 'ready',
    models: [
      { modelId: 'gpt-image-1', modelLabel: 'GPT Image 1', available: true, capabilities: ['image.generate'] },
      { modelId: 'gpt-4o-mini-tts', modelLabel: 'GPT 4o Mini TTS', available: true, capabilities: ['audio.synthesize'] },
    ],
  },
] as const;

describe('deriveMediaRouteDisplayState', () => {
  it('keeps media routes empty until the user explicitly selects a connector', () => {
    const result = deriveMediaRouteDisplayState([...CONNECTORS], '', '');
    assert.equal(result.activeConnectorId, '');
    assert.equal(result.selectedConnector, null);
    assert.deepEqual(result.models, []);
    assert.equal(result.invalidConnector, false);
    assert.equal(result.invalidModel, false);
  });

  it('surfaces invalid saved connectors without silently falling back', () => {
    const result = deriveMediaRouteDisplayState([...CONNECTORS], 'missing-connector', 'gpt-image-1');
    assert.equal(result.activeConnectorId, '');
    assert.equal(result.selectedConnector, null);
    assert.equal(result.invalidConnector, true);
    assert.equal(result.invalidModel, false);
  });

  it('surfaces invalid saved models on a valid connector', () => {
    const result = deriveMediaRouteDisplayState([...CONNECTORS], 'openai-primary', 'missing-model');
    assert.equal(result.activeConnectorId, 'openai-primary');
    assert.equal(result.invalidConnector, false);
    assert.equal(result.invalidModel, true);
  });
});
