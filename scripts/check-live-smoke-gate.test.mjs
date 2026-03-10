import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateChangedProviderEntries } from './check-live-smoke-gate.mjs';

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

test('sdk live smoke edits infer the touched provider from changed lines', () => {
  const result = evaluateChangedProviderEntries(
    new Set(['local', 'nimillm']),
    [{
      filePath: 'sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts',
      changedLines: [
        "test('nimi sdk ai-provider live smoke: nimillm generate text', {",
        "const model = createSdkTextModel(endpoint, 'cloud', modelID, 'nimillm');",
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
