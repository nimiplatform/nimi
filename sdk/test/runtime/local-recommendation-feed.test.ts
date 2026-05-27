import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS,
  normalizeLocalRecommendationFeedCapabilityId,
  parseLocalRecommendationFeedCapabilityId,
  toLocalRecommendationFeedCapabilityRequestValue,
} from '../../src/runtime/index.js';
import { LocalRecommendationFeedCapability } from '../../src/runtime/generated/runtime/v1/local_runtime_types.js';

test('local recommendation feed capabilities are projected from Runtime enum order', () => {
  assert.deepEqual(LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS, ['chat', 'image', 'video']);
});

test('local recommendation feed capability parser accepts Runtime wire names and values', () => {
  assert.equal(parseLocalRecommendationFeedCapabilityId(LocalRecommendationFeedCapability.CHAT), 'chat');
  assert.equal(parseLocalRecommendationFeedCapabilityId('LOCAL_RECOMMENDATION_FEED_CAPABILITY_IMAGE'), 'image');
  assert.equal(parseLocalRecommendationFeedCapabilityId('3'), 'video');
  assert.equal(parseLocalRecommendationFeedCapabilityId('tts'), undefined);
});

test('local recommendation feed capability request value fails closed to chat', () => {
  assert.equal(normalizeLocalRecommendationFeedCapabilityId('video'), 'video');
  assert.equal(normalizeLocalRecommendationFeedCapabilityId('music'), 'chat');
  assert.equal(toLocalRecommendationFeedCapabilityRequestValue('LOCAL_RECOMMENDATION_FEED_CAPABILITY_IMAGE'), 'image');
});
