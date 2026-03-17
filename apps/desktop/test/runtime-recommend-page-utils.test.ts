import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterRecommendationFeedItems,
  normalizeRecommendPageCapability,
  splitRecommendationFeedItems,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-recommend-utils.js';

test('normalizeRecommendPageCapability fails closed to chat for unsupported runtime pages', () => {
  assert.equal(normalizeRecommendPageCapability('tts'), 'chat');
  assert.equal(normalizeRecommendPageCapability('video'), 'video');
});

test('filterRecommendationFeedItems matches title repo and recommended entry', () => {
  const rows = [
    {
      itemId: 'a',
      title: 'Llama 3 8B',
      repo: 'meta-llama/Llama-3-8B-Instruct-GGUF',
      description: 'general chat',
      installPayload: { modelId: 'local/llama3' },
      recommendation: { recommendedEntry: 'llama-q4.gguf' },
      tags: ['chat'],
      capabilities: ['chat'],
      formats: ['gguf'],
    },
  ];

  assert.equal(filterRecommendationFeedItems(rows as never[], 'llama-q4').length, 1);
  assert.equal(filterRecommendationFeedItems(rows as never[], 'meta-llama').length, 1);
  assert.equal(filterRecommendationFeedItems(rows as never[], 'image').length, 0);
});

test('splitRecommendationFeedItems preserves order while grouping by installed state and tier', () => {
  const rows = [
    {
      itemId: 'recommended-1',
      installedState: { installed: false },
      recommendation: { tier: 'recommended' },
    },
    {
      itemId: 'installed-1',
      installedState: { installed: true },
      recommendation: { tier: 'recommended' },
    },
    {
      itemId: 'tight-1',
      installedState: { installed: false },
      recommendation: { tier: 'tight' },
    },
    {
      itemId: 'other-1',
      installedState: { installed: false },
      recommendation: { tier: 'not_recommended' },
    },
    {
      itemId: 'runnable-1',
      installedState: { installed: false },
      recommendation: { tier: 'runnable' },
    },
  ];

  const grouped = splitRecommendationFeedItems(rows as never[]);

  assert.deepEqual(grouped.topMatches.map((item) => item.itemId), ['recommended-1', 'runnable-1']);
  assert.deepEqual(grouped.worthTrying.map((item) => item.itemId), ['tight-1']);
  assert.deepEqual(grouped.alreadyInstalled.map((item) => item.itemId), ['installed-1']);
  assert.deepEqual(grouped.searchMore.map((item) => item.itemId), ['other-1']);
});
