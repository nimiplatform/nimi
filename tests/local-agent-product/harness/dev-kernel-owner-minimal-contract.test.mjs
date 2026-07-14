import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  DEV_KERNEL_OWNER_MINIMAL_CHECKPOINTS,
  validateOwnerMinimalResult,
} from './dev-kernel-owner-minimal-contract.mjs';

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
  const driver = fs.readFileSync(path.join(import.meta.dirname, 'dev-kernel-cross-app-driver.mjs'), 'utf8');
  assert.match(runner, /runDevKernelOwnerMinimalTrial/);
  assert.match(driver, /runDevKernelTrial\(\{ \.\.\.input, executionMode: 'owner-minimal' \}\)/);
  assert.doesNotMatch(runner, /go(?:\.exe)?['"\s,]+run|serve|node-grpc|runtime_bridge_status/iu);
});
