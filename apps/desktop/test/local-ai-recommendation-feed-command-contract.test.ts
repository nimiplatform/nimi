import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runtimeTypesPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/types.ts');
const runtimeCommandsPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/commands.ts');

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

test('recommendation feed command only forwards capability and pageSize payload fields', () => {
  assert.match(runtimeCommandsSource, /runtime_local_recommendation_feed_get/);
  assert.match(
    runtimeCommandsSource,
    /payload:\s*payload \?\s*\{\s*capability:\s*payload\.capability,\s*pageSize:\s*payload\.pageSize,\s*\}\s*:\s*undefined/,
  );
});
