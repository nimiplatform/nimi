import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAIN_LAYOUT_PATH = resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout.tsx');
const UI_SLICE_PATH = resolve(import.meta.dirname, '../src/shell/renderer/app-shell/providers/ui-slice.ts');
const SOP_PATH = resolve(import.meta.dirname, '../../../dev/plan/tab-switch-measurement-sop.md');

test('tab switch measurement instrumentation remains wired in main layout', () => {
  const source = readFileSync(MAIN_LAYOUT_PATH, 'utf-8');

  assert.match(source, /tabSwitchPending = \{ fromTab: activeTab, toTab: tabId, startMs: performance\.now\(\) \}/);
  assert.match(source, /message: 'action:tab-switch:committed'/);
  assert.match(source, /costMs = Number\(\(performance\.now\(\) - tabSwitchPending\.startMs\)\.toFixed\(2\)\)/);
  assert.match(source, /details: \{ fromTab: tabSwitchPending\.fromTab, toTab: tabSwitchPending\.toTab \}/);
});

test('tab activation remains wrapped in startTransition', () => {
  const source = readFileSync(UI_SLICE_PATH, 'utf-8');

  assert.match(source, /import \{ startTransition \} from 'react'/);
  assert.match(source, /setActiveTab: \(tab\) => \{\s*startTransition\(\(\) => \{\s*set\(\{ activeTab: tab \}\);/s);
});

test('measurement SOP covers required route-count matrix and profiler checks', () => {
  const source = readFileSync(SOP_PATH, 'utf-8');

  assert.match(source, /`1 \/ 3 \/ 5 \/ 10`/);
  assert.match(source, /Core tab switch/);
  assert.match(source, /Warm mod switch/);
  assert.match(source, /Cold mod switch/);
  assert.match(source, /React Profiler Capture/);
  assert.match(source, /background-throttled/);
  assert.match(source, /p95 tab switch time must not grow linearly/);
});
