import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHuggingFaceUrl,
  computeVramPercentage,
  filterRecommendationFeedItems,
  normalizeRecommendPageCapability,
  parseLicenseShort,
  parseParamsFromTitle,
  formatRepoOwnerFromRepo,
  parseQuantBitsFromEntry,
  parseQuantLevelFromEntry,
  quantQualityLabel,
  recommendationTier,
  recommendationTierLabel,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-recommend-utils.js';

test('normalizeRecommendPageCapability fails closed for unsupported runtime pages', () => {
  assert.equal(normalizeRecommendPageCapability('tts'), null);
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

test('recommendation tier presentation reflects only Runtime-issued tiers', () => {
  assert.equal(recommendationTier('recommended'), 'recommended');
  assert.equal(recommendationTier('runnable'), 'runnable');
  assert.equal(recommendationTier('tight'), 'tight');
  assert.equal(recommendationTier('not_recommended'), 'not_recommended');
  assert.equal(recommendationTier(undefined), null);
  assert.equal(recommendationTier('invented'), null);
  assert.equal(recommendationTierLabel('recommended'), 'Recommended');
  assert.equal(recommendationTierLabel(null), 'Unscored');
});

// ---------------------------------------------------------------------------
// New utility tests
// ---------------------------------------------------------------------------

test('parseParamsFromTitle extracts parameter count from model title', () => {
  assert.equal(parseParamsFromTitle('Llama 3.1 8B'), '8B');
  assert.equal(parseParamsFromTitle('Qwen 2.5 Coder 32B'), '32B');
  assert.equal(parseParamsFromTitle('Phi-4 14B'), '14B');
  assert.equal(parseParamsFromTitle('Phi-3.5 Mini'), '');
  assert.equal(parseParamsFromTitle('Some Model'), '');
});

test('parseLicenseShort normalizes license strings to short labels', () => {
  assert.equal(parseLicenseShort('apache-2.0'), 'Apache 2.0');
  assert.equal(parseLicenseShort('MIT'), 'MIT');
  assert.equal(parseLicenseShort('llama3.1'), 'Llama 3.1');
  assert.equal(parseLicenseShort(''), '');
  assert.equal(parseLicenseShort('unknown'), '');
});

test('formatRepoOwnerFromRepo formats the repository owner without provider mapping', () => {
  assert.equal(formatRepoOwnerFromRepo('meta-llama/Llama-3-8B-GGUF'), 'Meta Llama');
  assert.equal(formatRepoOwnerFromRepo('Qwen/Qwen2.5-7B-Instruct'), 'Qwen');
  assert.equal(formatRepoOwnerFromRepo('google/gemma-2-9b'), 'Google');
  assert.equal(formatRepoOwnerFromRepo('mistralai/Mistral-7B'), 'Mistralai');
  assert.equal(formatRepoOwnerFromRepo('bartowski/model-GGUF'), 'Bartowski');
});

test('computeVramPercentage returns correct percentage or null', () => {
  assert.equal(computeVramPercentage(4 * 1024 * 1024 * 1024, 12 * 1024 * 1024 * 1024), 33);
  assert.equal(computeVramPercentage(12 * 1024 * 1024 * 1024, 12 * 1024 * 1024 * 1024), 100);
  assert.equal(computeVramPercentage(0, 12 * 1024 * 1024 * 1024), null);
  assert.equal(computeVramPercentage(4 * 1024 * 1024 * 1024, 0), null);
  assert.equal(computeVramPercentage(4 * 1024 * 1024 * 1024, undefined), null);
});

// ---------------------------------------------------------------------------
// Quantization utility tests
// ---------------------------------------------------------------------------

test('parseQuantBitsFromEntry extracts bit depth from entry names', () => {
  assert.equal(parseQuantBitsFromEntry('model-Q4_K_M.gguf'), 4);
  assert.equal(parseQuantBitsFromEntry('model-Q5_K_M.gguf'), 5);
  assert.equal(parseQuantBitsFromEntry('model-Q8_0.gguf'), 8);
  assert.equal(parseQuantBitsFromEntry('model-F16.gguf'), 16);
  assert.equal(parseQuantBitsFromEntry('model-F32.gguf'), 32);
  assert.equal(parseQuantBitsFromEntry('model-IQ3_M.gguf'), 3);
  assert.equal(parseQuantBitsFromEntry('model-IQ2_S.gguf'), 2);
  assert.equal(parseQuantBitsFromEntry('model.gguf'), null);
  assert.equal(parseQuantBitsFromEntry(''), null);
});

test('parseQuantLevelFromEntry extracts quant label from entry names', () => {
  assert.equal(parseQuantLevelFromEntry('model-Q4_K_M.gguf'), 'Q4_K_M');
  assert.equal(parseQuantLevelFromEntry('model-Q8_0.gguf'), 'Q8_0');
  assert.equal(parseQuantLevelFromEntry('model-F16.gguf'), 'F16');
  assert.equal(parseQuantLevelFromEntry('model-IQ3_M.gguf'), 'IQ3_M');
  assert.equal(parseQuantLevelFromEntry('model.gguf'), '');
  assert.equal(parseQuantLevelFromEntry(''), '');
});

test('quantQualityLabel returns text labels based on bit depth', () => {
  assert.equal(quantQualityLabel(null), '');
  assert.equal(quantQualityLabel(16), 'Lossless');
  assert.equal(quantQualityLabel(32), 'Lossless');
  assert.equal(quantQualityLabel(8), 'High');
  assert.equal(quantQualityLabel(5), 'Medium-High');
  assert.equal(quantQualityLabel(4), 'Medium');
  assert.equal(quantQualityLabel(3), 'Low-Medium');
  assert.equal(quantQualityLabel(2), 'Low');
});

test('buildHuggingFaceUrl constructs URL from repo', () => {
  assert.equal(buildHuggingFaceUrl('meta-llama/Llama-3-8B-GGUF'), 'https://huggingface.co/meta-llama/Llama-3-8B-GGUF');
  assert.equal(buildHuggingFaceUrl('bartowski/model-GGUF'), 'https://huggingface.co/bartowski/model-GGUF');
});
