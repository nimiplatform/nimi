import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopRuntimeMaterialization = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/runtime-materialization.ts'),
  'utf8',
);
const desktopFirstRunIndexPath = resolve(import.meta.dirname, '../src/shell/renderer/first-run/index.ts');
const desktopResumeTest = readFileSync(
  resolve(import.meta.dirname, 'first-run-materialization-resume.test.ts'),
  'utf8',
);
const desktopWizardTest = readFileSync(
  resolve(import.meta.dirname, 'first-run-wizard.test.ts'),
  'utf8',
);
test('Desktop first-run materialization does not re-export SDK-owned materialization truth', () => {
  assert.doesNotMatch(desktopRuntimeMaterialization, /export\s+\{\s*NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE/);
  assert.equal(existsSync(desktopFirstRunIndexPath), false);
  assert.match(
    desktopRuntimeMaterialization,
    /productStateForNimiFirstRunMaterializationStatus[\s\S]*@nimiplatform\/sdk\/runtime/,
  );
  assert.doesNotMatch(desktopRuntimeMaterialization, /export function productStateForNimiFirstRunMaterializationStatus/);
  assert.doesNotMatch(desktopRuntimeMaterialization, /function withProductState/);
  assert.match(desktopRuntimeMaterialization, /firstRunRuntimeLocalClient/);
  assert.match(desktopRuntimeMaterialization, /resolveNimiFirstRunMaterializationProjection/);
  assert.doesNotMatch(desktopRuntimeMaterialization, /\blocalRuntime\b/);
});

test('Desktop first-run materialization tests do not retain SDK-only behavior cases', () => {
  for (const sdkOnlyEvidence of [
    'waiting for lock on uv cache',
    'model file hash mismatch',
    'job-stale-failed',
    'aggregateNimiFirstRunMaterializationDownloadProgress projects Runtime job progress',
  ]) {
    assert.doesNotMatch(desktopResumeTest, new RegExp(sdkOnlyEvidence));
    assert.doesNotMatch(desktopWizardTest, new RegExp(sdkOnlyEvidence));
  }
});
