import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const HOST_CAPABILITIES_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts',
);

test('D-STRM-010: runtime host media.jobs path is wired to scenario job controller', () => {
  const source = readFileSync(HOST_CAPABILITIES_PATH, 'utf8');
  const jobsStart = source.indexOf('jobs: {');
  const jobsEnd = source.indexOf('voice: {', jobsStart);
  assert.ok(jobsStart >= 0 && jobsEnd > jobsStart, 'expected media.jobs block in runtime-bootstrap-host-capabilities.ts');

  const jobsBlock = source.slice(jobsStart, jobsEnd);
  assert.ok(jobsBlock.includes('startJobTracking('), 'expected media.jobs path to start job tracking');
  assert.ok(jobsBlock.includes('feedJobEvent('), 'expected media.jobs path to feed controller events');
  assert.ok(jobsBlock.includes('requestCancel('), 'expected media.jobs cancel path to delegate to scenario-job-controller');
  assert.ok(jobsBlock.includes('startPollingRecovery('), 'expected media.jobs subscribe path to start polling recovery on interruption');
});
