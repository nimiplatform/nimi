#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readFixedServiceStatus } from './dev-kernel-host-driver.mjs';
import { repoRoot } from './registry.mjs';
import { captureSourceState } from './source-state.mjs';

const expectedTests = Object.freeze([
  'TestLocalAppPublicPermissionStatusKeepsReservedCatalogUnavailable',
  'TestAuthorizeLocalAppStorageUsesBaseEntitlementWithoutPermission',
  'TestAuthorizeLocalAppStorageStillRequiresExactLiveProcess',
  'TestLocalAppPermissionPreflightDistinguishesRawUncarriedFromStaleProcess',
  'TestProtectedLocalAppPoliciesExposeOnlyBaseEntitlementsAndPermissionPosture',
]);
const rustProjectionTest = 'local_app_preflight_stale_process_projects_process_replaced';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`dev-kernel protected-carrier preflight requires Windows x64, got ${process.platform}/${process.arch}`);
}

const sourceState = captureSourceState(repoRoot);
const before = requireFixedService(readFixedServiceStatus());
const result = spawnSync('go', [
  'test', './internal/services/account', './internal/grpcserver',
  '-run', `^(${expectedTests.join('|')})$`, '-count=1', '-json',
], {
  cwd: path.join(repoRoot, 'runtime'),
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024,
});
if (result.error) throw result.error;
const rows = String(result.stdout || '').split(/\r?\n/u).filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean);
const passed = new Set(rows
  .filter((row) => row.Action === 'pass' && expectedTests.includes(row.Test))
  .map((row) => row.Test));
const failed = rows
  .filter((row) => row.Action === 'fail' && typeof row.Test === 'string')
  .map((row) => row.Test);
if (result.status !== 0 || failed.length > 0 || expectedTests.some((name) => !passed.has(name))) {
  throw new Error(`dev-kernel protected-carrier preflight owner matrix failed: ${JSON.stringify({
    exitCode: result.status,
    failed,
    missing: expectedTests.filter((name) => !passed.has(name)),
  })}`);
}
const rust = spawnSync('cargo', [
  'test', '--manifest-path', 'kit/shell/protected-local/Cargo.toml', rustProjectionTest,
], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024,
});
if (rust.error) throw rust.error;
if (rust.status !== 0 || !String(rust.stdout || '').includes('test result: ok')) {
  throw new Error(`dev-kernel protected-carrier preflight projection matrix failed: ${JSON.stringify({ exitCode: rust.status })}`);
}
const after = requireFixedService(readFixedServiceStatus());
if (after.processId !== before.processId
  || after.runtimeCandidateId !== before.runtimeCandidateId
  || after.runtimeBinarySha256 !== before.runtimeBinarySha256) {
  throw new Error('fixed Runtime service changed during protected-carrier preflight');
}
const evidence = {
  schemaVersion: 'nimi.dev-kernel-carrier-preflight/v1',
  acceptanceEligible: false,
  posture: 'targeted_source_and_fixed_service_preflight',
  observedAt: new Date().toISOString(),
  sourceState,
  runtimeCandidate: {
    serviceName: before.serviceName,
    state: before.state,
    processId: before.processId,
    runtimeCandidateId: before.runtimeCandidateId,
    runtimeBinarySha256: before.runtimeBinarySha256,
    runtimeBuildRecordSha256: before.runtimeBuildRecordSha256,
    checkpointCandidatePostureVerified: before.checkpointCandidatePostureVerified,
    desktopPipePresent: before.desktopPipePresent,
    localAppPipePresent: before.localAppPipePresent,
  },
  assertions: {
    ...Object.fromEntries(expectedTests.map((name) => [name, 'passed'])),
    [rustProjectionTest]: 'passed',
  },
};
const evidenceRoot = path.join(repoRoot, '.nimi', 'local', 'evidence', 'dev-kernel-carrier-preflight');
fs.mkdirSync(evidenceRoot, { recursive: true });
const evidencePath = path.join(evidenceRoot, `${sourceState.sourceDigest.slice(0, 16)}-${Date.now()}.json`);
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`dev-kernel protected-carrier preflight: PASS (${evidencePath})\n`);

function requireFixedService(status) {
  if (status?.serviceName !== 'NimiRuntime'
    || status?.state !== 'running'
    || !Number.isSafeInteger(status?.processId)
    || status.processId <= 0
    || status?.desktopPipePresent !== true
    || status?.localAppPipePresent !== true
    || status?.checkpointCandidatePostureVerified !== true
    || !/^dev-kernel-runtime-[a-f0-9]{32}$/u.test(String(status?.runtimeCandidateId || ''))
    || !/^[a-f0-9]{64}$/u.test(String(status?.runtimeBinarySha256 || ''))
    || !/^[a-f0-9]{64}$/u.test(String(status?.runtimeBuildRecordSha256 || ''))) {
    throw new Error('fixed Runtime service is not ready for targeted protected-carrier preflight');
  }
  return status;
}
