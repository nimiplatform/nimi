import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHuggingFaceUrl,
  computeTierCounts,
  computeVramPercentage,
  filterRecommendationFeedItems,
  gradeLabel,
  normalizeRecommendPageCapability,
  parseLicenseShort,
  parseParamsFromTitle,
  parseProviderFromRepo,
  parseQuantBitsFromEntry,
  parseQuantLevelFromEntry,
  quantQualityLabel,
  splitRecommendationFeedItems,
  tierToGrade,
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

// ---------------------------------------------------------------------------
// New utility tests
// ---------------------------------------------------------------------------

test('tierToGrade maps internal tiers to display grades', () => {
  assert.equal(tierToGrade('recommended'), 'runs_great');
  assert.equal(tierToGrade('runnable'), 'runs_well');
  assert.equal(tierToGrade('tight'), 'tight_fit');
  assert.equal(tierToGrade('not_recommended'), 'not_recommended');
  assert.equal(tierToGrade(undefined), 'not_recommended');
});

test('gradeLabel returns human-readable grade labels', () => {
  assert.equal(gradeLabel('runs_great'), 'Runs Great');
  assert.equal(gradeLabel('runs_well'), 'Runs Well');
  assert.equal(gradeLabel('tight_fit'), 'Tight Fit');
  assert.equal(gradeLabel('not_recommended'), 'Not Recommended');
});

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

test('parseProviderFromRepo extracts provider from repo org', () => {
  assert.equal(parseProviderFromRepo('meta-llama/Llama-3-8B-GGUF'), 'Meta');
  assert.equal(parseProviderFromRepo('Qwen/Qwen2.5-7B-Instruct'), 'Alibaba');
  assert.equal(parseProviderFromRepo('google/gemma-2-9b'), 'Google');
  assert.equal(parseProviderFromRepo('mistralai/Mistral-7B'), 'Mistral');
  assert.equal(parseProviderFromRepo('bartowski/model-GGUF'), 'bartowski');
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

test('quantQualityLabel returns star ratings based on bit depth', () => {
  assert.equal(quantQualityLabel(null), '');
  assert.equal(quantQualityLabel(16), '\u2605\u2605\u2605\u2605\u2605');
  assert.equal(quantQualityLabel(8), '\u2605\u2605\u2605\u2605\u2606');
  assert.equal(quantQualityLabel(5), '\u2605\u2605\u2605\u2606\u2606');
  assert.equal(quantQualityLabel(4), '\u2605\u2605\u2606\u2606\u2606');
  assert.equal(quantQualityLabel(3), '\u2605\u2606\u2606\u2606\u2606');
  assert.equal(quantQualityLabel(2), '\u2606\u2606\u2606\u2606\u2606');
});

test('buildHuggingFaceUrl constructs URL from repo', () => {
  assert.equal(buildHuggingFaceUrl('meta-llama/Llama-3-8B-GGUF'), 'https://huggingface.co/meta-llama/Llama-3-8B-GGUF');
  assert.equal(buildHuggingFaceUrl('bartowski/model-GGUF'), 'https://huggingface.co/bartowski/model-GGUF');
});

test('computeTierCounts aggregates items by grade', () => {
  const items = [
    { recommendation: { tier: 'recommended' } },
    { recommendation: { tier: 'recommended' } },
    { recommendation: { tier: 'runnable' } },
    { recommendation: { tier: 'tight' } },
    { recommendation: { tier: 'not_recommended' } },
    { recommendation: {} },
  ];
  const counts = computeTierCounts(items as never[]);
  assert.equal(counts.runs_great, 2);
  assert.equal(counts.runs_well, 1);
  assert.equal(counts.tight_fit, 1);
  assert.equal(counts.not_recommended, 2);
});
