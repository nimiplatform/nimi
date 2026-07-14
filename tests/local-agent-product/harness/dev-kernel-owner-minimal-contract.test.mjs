import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  DEV_KERNEL_OWNER_MINIMAL_CHECKPOINTS,
  validateOwnerMinimalResult,
} from './dev-kernel-owner-minimal-contract.mjs';

function ownerDriverSource() {
  return [
    'dev-kernel-first-run-driver.mjs',
    'dev-kernel-cross-app-driver.mjs',
    'dev-kernel-local-development-driver.mjs',
  ].map((file) => fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')).join('\n');
}

function validResult() {
  return {
    schemaVersion: 'nimi.local-agent-product-owner-minimal-result/v1',
    journeyId: 'dev-kernel-owner-minimal',
    outcome: 'passed',
    privacy: { ok: true, findings: [] },
    checkpoints: DEV_KERNEL_OWNER_MINIMAL_CHECKPOINTS.map((checkpointId) => ({
      checkpointId,
      outcome: 'passed',
    })),
    artifacts: [
      { artifactId: 'owner-minimal-summary' },
      { artifactId: 'owner-minimal-dom-console-a11y' },
      { artifactId: 'owner-minimal-shell-1' },
      { artifactId: 'owner-minimal-shell-2' },
      { artifactId: 'owner-minimal-shell-3' },
    ],
  };
}

test('owner-minimal contract accepts the canonical six-step permission journey', () => {
  assert.deepEqual(validateOwnerMinimalResult(validResult()), []);
});

test('owner-minimal contract rejects reordered, failed, private, or screenshot-free results', () => {
  const fixture = validResult();
  fixture.checkpoints.reverse();
  fixture.checkpoints[0].outcome = 'failed';
  fixture.privacy = { ok: false, findings: ['authority material'] };
  fixture.artifacts = fixture.artifacts.filter((artifact) => !artifact.artifactId.startsWith('owner-minimal-shell-'));
  assert.match(
    validateOwnerMinimalResult(fixture).join('; '),
    /privacy.*checkpoints.*screenshots/iu,
  );
});

test('owner-minimal runner reuses the core driver and does not create another carrier', () => {
  const runner = fs.readFileSync(path.join(import.meta.dirname, 'run-owner-minimal.mjs'), 'utf8');
  const driver = ownerDriverSource();
  assert.match(runner, /runDevKernelOwnerMinimalTrial/);
  assert.match(driver, /runDevKernelTrial\(\{ \.\.\.input, executionMode: 'owner-minimal' \}\)/);
  assert.doesNotMatch(runner, /go(?:\.exe)?['"\s,]+run|serve|node-grpc|runtime_bridge_status/iu);
});

test('owner-minimal reuses a protected ready round after a transient First Run gate', () => {
  const driver = ownerDriverSource();
  assert.match(driver, /primaryLogin\.outcome === 'first-run'[\s\S]*productControl\?\.state === 'ready_for_use'[\s\S]*captureReusedReadyFirstRun/iu);
  assert.match(driver, /captureReusedReadyFirstRun[\s\S]*requireCheckpointDataRootProposal[\s\S]*waitForTestId\(page, 'main-shell'[\s\S]*PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD/iu);
  assert.match(driver, /current\?\.state !== 'ready_for_use'[\s\S]*page\.reload\(\{ waitUntil: 'domcontentloaded'[\s\S]*waitForTestId\(page, 'main-shell'/iu);
  assert.match(driver, /ready-shell-transition[\s\S]*captureReusedReadyFirstRun[\s\S]*reuseReadyCandidateId: serviceBefore\.runtimeCandidateId/iu);
});

test('owner-minimal waits for the Runtime-owned Developer Mode projection before toggling', () => {
  const driver = ownerDriverSource();
  assert.match(driver, /label: 'Developer Mode Runtime projection'/u);
  assert.match(driver, /developer-mode-retry-button[\s\S]*Developer Mode Runtime projection unavailable/iu);
  assert.match(driver, /card\.getAttribute\('data-developer-mode'\) === expected[\s\S]*button\.isEnabled/iu);
});

test('owner-minimal resolves the Desktop-owned presence file from the real launcher home only', () => {
  const driver = ownerDriverSource();
  assert.match(driver, /function startZhiyuDev[\s\S]*const launcherHome = os\.homedir\(\)[\s\S]*HOME: launcherHome, USERPROFILE: launcherHome/iu);
  assert.match(driver, /NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: trial\.paths\.zhiyuUserData/iu);
});
