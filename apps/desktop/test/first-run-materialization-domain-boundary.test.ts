import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopRuntimeMaterialization = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/runtime-materialization.ts'),
  'utf8',
);
const desktopFirstRunIndex = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/index.ts'),
  'utf8',
);
const desktopResumeTest = readFileSync(
  resolve(import.meta.dirname, 'first-run-materialization-resume.test.ts'),
  'utf8',
);
const desktopWizardTest = readFileSync(
  resolve(import.meta.dirname, 'first-run-wizard.test.ts'),
  'utf8',
);
test('Desktop first-run materialization does not re-export SDK-owned materialization truth', () => {
  assert.doesNotMatch(desktopRuntimeMaterialization, /export\s+\{\s*FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE/);
  assert.doesNotMatch(desktopFirstRunIndex, /FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE/);
  assert.match(
    desktopRuntimeMaterialization,
    /productStateForMaterializationStatus[\s\S]*@nimiplatform\/sdk\/runtime/,
  );
  assert.doesNotMatch(desktopRuntimeMaterialization, /export function productStateForMaterializationStatus/);
  assert.doesNotMatch(desktopRuntimeMaterialization, /function withProductState/);
  assert.match(desktopRuntimeMaterialization, /localRuntime/);
});

test('Desktop first-run materialization tests do not retain SDK-only behavior cases', () => {
  for (const sdkOnlyEvidence of [
    'waiting for lock on uv cache',
    'model file hash mismatch',
    'job-stale-failed',
    'aggregateMaterializationDownloadProgress projects Runtime job progress',
  ]) {
    assert.doesNotMatch(desktopResumeTest, new RegExp(sdkOnlyEvidence));
    assert.doesNotMatch(desktopWizardTest, new RegExp(sdkOnlyEvidence));
  }
});
