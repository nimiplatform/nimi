import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const MAIN_LAYOUT_VIEW_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/app-shell/layouts/main-layout-view.tsx',
);

const STATUS_HOST_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/turns/scenario-job-status-host.tsx',
);

test('D-STRM-010: scenario job status host is mounted in the desktop shell', () => {
  const source = readFileSync(MAIN_LAYOUT_VIEW_PATH, 'utf8');
  assert.ok(source.includes("import { ScenarioJobStatusHost }"), 'expected main layout to import scenario job status host');
  assert.ok(source.includes('<ScenarioJobStatusHost />'), 'expected main layout to render scenario job status host');
});

test('D-STRM-010: scenario job status host subscribes to controller state and renders progress UI', () => {
  const source = readFileSync(STATUS_HOST_PATH, 'utf8');
  assert.ok(source.includes('subscribeJobEvents('), 'expected status host to subscribe to scenario job controller events');
  assert.ok(source.includes('clearJobTracking('), 'expected status host to clear terminal jobs after display');
  assert.ok(source.includes('<ScenarioJobProgress'), 'expected status host to render scenario job progress');
});
