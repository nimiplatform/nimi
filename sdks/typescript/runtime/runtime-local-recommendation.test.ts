import assert from 'node:assert/strict';
import test from 'node:test';

import { projectNimiRuntimeLocalRecommendationFeedItem } from './runtime-local-recommendation.js';

const item = {
  itemId: 'recommendation.test',
  source: 'model-index',
  repo: 'example/model',
  title: 'Example model',
  preferredEngine: 'llama.cpp',
  installPayload: {
    repo: 'example/model',
  },
};

test('local recommendation projection requires the current modelId contract', () => {
  assert.equal(projectNimiRuntimeLocalRecommendationFeedItem({
    ...item,
    installPayload: { ...item.installPayload, assetId: 'legacy-asset-id' },
  }), undefined);
  assert.equal(projectNimiRuntimeLocalRecommendationFeedItem({
    ...item,
    installPayload: { ...item.installPayload, modelId: 'current-model-id' },
  })?.installPayload.modelId, 'current-model-id');
});
