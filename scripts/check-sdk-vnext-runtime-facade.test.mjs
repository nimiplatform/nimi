import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RUNTIME_FACADE_NEGATIVE_FIXTURES,
  loadSdkVnextRuntimeFacadeCandidate,
  runSdkVnextRuntimeFacadeNegativeFixtures,
  validateSdkVnextRuntimeFacadeCandidate,
} from './lib/sdk-vnext-runtime-facade-check.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gate = path.join(scriptDir, 'check-sdk-vnext-runtime-facade.mjs');

test('current Runtime facade matches the admitted browser/public projection', () => {
  assert.deepEqual(validateSdkVnextRuntimeFacadeCandidate(loadSdkVnextRuntimeFacadeCandidate(repoRoot)), []);
});

test('negative fixtures reject omitted portable methods and exposed native or unavailable methods', () => {
  const report = runSdkVnextRuntimeFacadeNegativeFixtures(loadSdkVnextRuntimeFacadeCandidate(repoRoot));
  assert.deepEqual(report.map((row) => row.fixtureId), RUNTIME_FACADE_NEGATIVE_FIXTURES.map((row) => row.fixtureId));
  assert.equal(new Set(report.map((row) => row.fixtureId)).size, RUNTIME_FACADE_NEGATIVE_FIXTURES.length);
  for (const row of report) assert.match(row.reason, /\S/u);
});

test('CLI validates the current candidate before reporting independent fixtures', () => {
  const result = spawnSync(process.execPath, [gate, '--fixture-report-json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.fixtures.map((row) => row.code), RUNTIME_FACADE_NEGATIVE_FIXTURES.map((row) => row.expectedCode));
});
