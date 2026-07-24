import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pruneOldGateEvidenceRuns } from './evidence-retention.mjs';

function makeRun(root, name, mtimeMs) {
  const run = path.join(root, name);
  fs.mkdirSync(run, { recursive: true });
  const timestamp = new Date(mtimeMs);
  fs.utimesSync(run, timestamp, timestamp);
  return run;
}

test('gate evidence retention keeps two prior runs for the new run slot and ignores other gates', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-evidence-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = makeRun(root, 'v2-core-aaaaaaaaaaaa-1000', 1_000);
  const middle = makeRun(root, 'v2-core-bbbbbbbbbbbb-2000', 2_000);
  const latest = makeRun(root, 'v2-core-cccccccccccc-3000', 3_000);
  const stability = makeRun(root, 'v2-core-stability-dddddddddddd-1000', 1_000);

  const result = pruneOldGateEvidenceRuns(root, 'core', { retainPriorRuns: 2 });

  assert.deepEqual(result, { removed: [old], failed: [] });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(middle), true);
  assert.equal(fs.existsSync(latest), true);
  assert.equal(fs.existsSync(stability), true);
});

test('gate evidence retention cold-starts when the evidence base is absent', () => {
  const root = path.join(os.tmpdir(), `nimi-evidence-retention-missing-${process.pid}-${Date.now()}`);
  assert.deepEqual(pruneOldGateEvidenceRuns(root, 'core'), { removed: [], failed: [] });
});
