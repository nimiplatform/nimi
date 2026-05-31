import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runtimeTypesPath = path.resolve(process.cwd(), '../../sdk/src/runtime/local-runtime-client/types.ts');
const runtimeCommandsPath = path.resolve(process.cwd(), '../../sdk/src/runtime/local-runtime-client/commands.ts');

const runtimeTypesSource = readFileSync(runtimeTypesPath, 'utf-8');
const runtimeCommandsSource = readFileSync(runtimeCommandsPath, 'utf-8');

test('recommendation feed request payload is capability-enum-only', () => {
  assert.match(
    runtimeTypesSource,
    /export type LocalRuntimeRecommendationFeedGetPayload = \{\s*capability\?: LocalRuntimeRecommendationFeedCapability;/,
  );
  assert.doesNotMatch(
    runtimeTypesSource,
    /export type LocalRuntimeRecommendationFeedGetPayload = \{\s*capability\?: .*string/,
  );
});

test('recommendation feed command uses Runtime SDK projection, not Tauri command truth', () => {
  assert.doesNotMatch(runtimeCommandsSource, /runtime_local_recommendation_feed_get/);
  assert.doesNotMatch(runtimeCommandsSource, /invokeLocalRuntimeCommand/);
  assert.match(runtimeCommandsSource, /requireSdkLocal\(\)/);
  assert.match(runtimeCommandsSource, /runtime\.getRecommendationFeed\(\{/);
  assert.match(
    runtimeCommandsSource,
    /capability:\s*toLocalRecommendationFeedCapabilityRequestValue\(payload\?\.capability\),\s*pageSize:\s*Number\(payload\?\.pageSize \|\| 0\),/,
  );
});
