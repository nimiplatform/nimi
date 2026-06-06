import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { evaluateChangedProviderEntries, resolveRequiredProviders } from './check-live-smoke-gate.mjs';

function toSortedValues(input) {
  return [...input].sort();
}

test('runtime live smoke edits infer the touched provider from changed lines', () => {
  const result = evaluateChangedProviderEntries(
    new Set(['openai', 'anthropic']),
    [{
      filePath: 'runtime/internal/services/ai/live_provider_smoke_test.go',
      changedLines: [
        'func TestLiveSmokeOpenAIGenerateText(t *testing.T) {',
        'runLiveSmokeCloudGenerateText(t, "openai", "OPENAI", "https://api.openai.com/v1")',
      ],
    }],
  );

  assert.deepEqual(toSortedValues(result.changedProviders), ['openai']);
  assert.deepEqual(result.unresolvedSmokeFiles, []);
});

test('runtime live smoke matrix edits infer provider-specific branches', () => {
  const result = evaluateChangedProviderEntries(
    new Set(['fish_audio', 'stepfun']),
    [{
      filePath: 'runtime/internal/services/ai/live_provider_smoke_matrix_test.go',
      changedLines: [
        'if !strings.EqualFold(strings.TrimSpace(providerID), "fish_audio") {',
        'return',
      ],
    }],
  );

  assert.deepEqual(toSortedValues(result.changedProviders), ['fish_audio']);
  assert.deepEqual(result.unresolvedSmokeFiles, []);
});

test('SDK vNext live smoke edits infer the touched provider from changed lines', () => {
  const result = evaluateChangedProviderEntries(
    new Set(['local', 'nimillm']),
    [{
      filePath: 'sdks/typescript/runtime/live-provider-smoke.test.ts',
      changedLines: [
        "test('nimi sdk vnext live smoke: nimillm generate', {",
        "const provider = 'nimillm';",
      ],
    }],
  );

  assert.deepEqual(toSortedValues(result.changedProviders), ['nimillm']);
  assert.deepEqual(result.unresolvedSmokeFiles, []);
});

test('generic smoke harness edits fail closed instead of misreporting a provider', () => {
  const result = evaluateChangedProviderEntries(
    new Set(['openai', 'anthropic']),
    [{
      filePath: 'runtime/internal/services/ai/live_provider_smoke_test.go',
      changedLines: [
        'func requiredLiveEnv(t *testing.T, key string) string {',
        'value := strings.TrimSpace(os.Getenv(key))',
      ],
    }],
  );

  assert.deepEqual(toSortedValues(result.changedProviders), []);
  assert.deepEqual(result.unresolvedSmokeFiles, [
    'runtime/internal/services/ai/live_provider_smoke_test.go',
  ]);
});

test('release mode falls back to configured providers instead of every provider in report', () => {
  const requiredProviders = resolveRequiredProviders({
    baselineProviders: new Set(),
    conditionalProviders: new Set(),
    changedProviders: new Set(),
    reportProviders: new Set(['dashscope', 'gemini', 'openai']),
    configuredProviders: new Set(['dashscope', 'gemini']),
    exemptions: new Set(),
    requireRelease: true,
  });

  assert.deepEqual(toSortedValues(requiredProviders), ['dashscope', 'gemini']);
});

test('live matrix reads provider catalog from active .nimi authority', () => {
  const source = readFileSync(new URL('./run-live-test-matrix.mjs', import.meta.url), 'utf8');

  assert.match(source, /\.nimi\/spec\/runtime\/kernel\/tables\/provider-catalog\.yaml/);
  assert.doesNotMatch(source, /['"`]spec\/runtime\/kernel\/tables\/provider-catalog\.yaml['"`]/);
});
