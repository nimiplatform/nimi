import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.join(import.meta.dirname, 'run-dev-kernel-grant-preflight.mjs'), 'utf8');

test('grant preflight binds fixed-service identity to the four focused owner assertions', () => {
  for (const name of [
    'TestLocalAppGrantPreflightExactSharedGrantProjection',
    'TestLocalAppGrantPreflightStaleSupervisedProcessIsProcessReplaced',
    'TestLocalAppGrantPreflightRevokeDeniesNextOperation',
    'TestLocalAppGrantPreflightDistinguishesRawUncarriedFromStaleProcess',
  ]) assert.match(source, new RegExp(name, 'u'));
  assert.match(source, /local_app_preflight_stale_process_projects_process_replaced/u);
  assert.match(source, /desktopPipePresent[\s\S]*localAppPipePresent[\s\S]*checkpointCandidatePostureVerified/u);
  assert.match(source, /acceptanceEligible:\s*false/u);
  assert.doesNotMatch(source, /runDevKernel(?:OwnerMinimal|Core)Trial|runRealChromeLogin|test:runtime:full/u);
});
