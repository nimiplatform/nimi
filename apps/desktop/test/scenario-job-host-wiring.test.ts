import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const RETIRED_HOST_CAPABILITIES_MEDIA_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-media.ts',
);
const SCENARIO_JOB_CONTROLLER_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/turns/scenario-job-controller.ts',
);

test('D-STRM-010: retired runtime host media.jobs bootstrap path is absent', () => {
  assert.throws(() => readFileSync(RETIRED_HOST_CAPABILITIES_MEDIA_PATH, 'utf8'), /ENOENT/);
  const source = readFileSync(SCENARIO_JOB_CONTROLLER_PATH, 'utf8');
  assert.ok(source.includes('startJobTracking('), 'scenario job controller keeps job tracking authority');
  assert.ok(source.includes('requestCancel('), 'scenario job controller keeps cancel authority');
  assert.ok(source.includes('startPollingRecovery('), 'scenario job controller keeps polling recovery authority');
});
