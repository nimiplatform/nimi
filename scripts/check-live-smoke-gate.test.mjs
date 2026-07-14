import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  evaluateChangedProviderEntries,
  evaluateSdkProtectedCarrierProof,
  resolveRequiredProviders,
} from './check-live-smoke-gate.mjs';

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

test('SDK hardcut edits are not provider-matrix evidence', () => {
  const result = evaluateChangedProviderEntries(
    new Set(['local', 'nimillm']),
    [{
      filePath: 'sdks/typescript/runtime/public-credential-grant-hardcut.test.ts',
      changedLines: [
        "test('Runtime public surface has no credential-grant facade', () => {",
        "assert.equal('grants' in runtime, false);",
      ],
    }],
  );

  assert.deepEqual(toSortedValues(result.changedProviders), []);
  assert.deepEqual(result.unresolvedSmokeFiles, []);
});

test('release mode fails closed without admitted SDK protected-carrier proof', () => {
  assert.deepEqual(
    evaluateSdkProtectedCarrierProof({}, { requireRelease: true }).failures,
    ['sdk:protected_carrier:missing_admitted_candidate_proof'],
  );
});

test('retired SDK provider matrix is rejected instead of treated as carrier proof', () => {
  assert.deepEqual(
    evaluateSdkProtectedCarrierProof({ sdk: { dashscope: { generate: { status: 'passed' } } } }, { requireRelease: false }).failures,
    ['sdk:retired_provider_capability_matrix_not_admitted'],
  );
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

test('live matrix fails closed on declared cells with no test result', () => {
  const source = readFileSync(new URL('./run-live-test-matrix.mjs', import.meta.url), 'utf8');

  assert.match(source, /summary\.no_test\s*>\s*0/);
  assert.match(source, /declared cells with no test result/);
  assert.doesNotMatch(source, /parseSdkLiveTestDefinitions|NIMI_SDK_LIVE|run-dashscope-gold-path/);
});
