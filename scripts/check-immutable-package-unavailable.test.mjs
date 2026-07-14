import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CANDIDATE_PATHS,
  IMMUTABLE_PACKAGE_METHOD_IDS,
  NEGATIVE_FIXTURES,
  loadImmutablePackageCandidate,
  runImmutablePackageNegativeFixtures,
  validateImmutablePackageCandidate,
} from './lib/immutable-package-unavailable-check.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gate = path.join(scriptDir, 'check-immutable-package-unavailable.mjs');

test('current repository is the positive immutable-package-unavailable candidate', () => {
  assert.deepEqual(validateImmutablePackageCandidate(loadImmutablePackageCandidate(repoRoot)), []);
});

test('the frozen positive package method set is exact', () => {
  assert.deepEqual(IMMUTABLE_PACKAGE_METHOD_IDS, [
    '/nimi.runtime.v1.RuntimeAppService/PrepareAppLifecycleIntent',
    '/nimi.runtime.v1.RuntimeAppService/GetAppLifecycleIntentStatus',
    '/nimi.runtime.v1.RuntimeAppService/InstallApp',
    '/nimi.runtime.v1.RuntimeAppService/UninstallApp',
    '/nimi.runtime.v1.RuntimeAppService/GetAppInstallJob',
    '/nimi.runtime.v1.RuntimeAppService/ListAppInstallJobs',
    '/nimi.runtime.v1.RuntimeAppService/WatchAppInstallJobEvents',
    '/nimi.runtime.v1.RuntimeAppService/UpdateApp',
    '/nimi.runtime.v1.RuntimeAppService/HealthRepairApp',
  ]);
});

test('negative mutations independently exercise every cross-layer boundary', () => {
  const report = runImmutablePackageNegativeFixtures(loadImmutablePackageCandidate(repoRoot));
  assert.deepEqual(report.map((row) => row.fixtureId), NEGATIVE_FIXTURES.map((row) => row.fixtureId));
  assert.equal(new Set(report.map((row) => row.fixtureId)).size, NEGATIVE_FIXTURES.length);
  assert.deepEqual(new Set(report.map((row) => row.issueCount)), new Set([1]));
  for (const row of report) assert.match(row.reason, /\S/u);
});

test('CLI fixture report validates the real candidate before emitting mutations', () => {
  const result = spawnSync(process.execPath, [gate, '--fixture-report-json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fixtures.length, NEGATIVE_FIXTURES.length);
  assert.deepEqual(report.fixtures.map((row) => row.code), NEGATIVE_FIXTURES.map((row) => row.expectedCode));
});

test('Desktop source root is part of the candidate rather than a synthetic parity packet', () => {
  const files = loadImmutablePackageCandidate(repoRoot);
  const desktopFiles = [...files.keys()].filter((relative) => relative.startsWith(`${CANDIDATE_PATHS.desktopAppsRoot}/`));
  assert.ok(desktopFiles.length >= 4, 'expected real Desktop Apps renderer sources');
});
