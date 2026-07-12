import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  HARNESS_OWNER_MARKER,
  RUNTIME_DAEMON_PID_FILE,
  TRIAL_ROOT_PREFIX,
  isStaleTrialRoot,
  pruneRetainedTrialRootPayload,
  sweepStaleIsolatedTrialRoots,
  writeHarnessOwnerMarker,
} from './sandbox-hygiene.mjs';

const DEAD_PID = 999_999_999;

function makeFakeTmpDir(t) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-hygiene-test-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  return tmpDir;
}

function makeTrialRoot(tmpDir, name, marker) {
  const root = path.join(tmpDir, `${TRIAL_ROOT_PREFIX}${name}`);
  fs.mkdirSync(root, { recursive: true });
  if (marker) fs.writeFileSync(path.join(root, HARNESS_OWNER_MARKER), `${JSON.stringify(marker)}\n`);
  return root;
}

test('trial roots with a dead harness owner are stale regardless of age', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'dead-owner', { pid: DEAD_PID, startedAt: new Date().toISOString() });
  assert.equal(isStaleTrialRoot(root), true);
});

test('trial roots with a live recent owner are not stale', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'live-owner', { pid: process.pid, startedAt: new Date().toISOString() });
  assert.equal(isStaleTrialRoot(root), false);
});

test('markerless trial roots go stale by age only', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'markerless', null);
  assert.equal(isStaleTrialRoot(root, { maxAgeMs: 60_000 }), false);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(root, old, old);
  assert.equal(isStaleTrialRoot(root, { maxAgeMs: 60_000 }), true);
});

test('writeHarnessOwnerMarker records the current process as the owner', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const marker = writeHarnessOwnerMarker(tmpDir);
  assert.equal(marker.pid, process.pid);
  const persisted = JSON.parse(fs.readFileSync(path.join(tmpDir, HARNESS_OWNER_MARKER), 'utf8'));
  assert.equal(persisted.pid, process.pid);
  assert.ok(Number.isFinite(Date.parse(persisted.startedAt)));
});

test('sweep removes stale roots, keeps active roots, and ignores foreign directories', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const stale = makeTrialRoot(tmpDir, 'full-chain-core-r1-stale', { pid: DEAD_PID, startedAt: new Date().toISOString() });
  const active = makeTrialRoot(tmpDir, 'full-chain-core-r1-active', { pid: process.pid, startedAt: new Date().toISOString() });
  const foreign = path.join(tmpDir, 'unrelated-dir');
  fs.mkdirSync(foreign, { recursive: true });
  const result = sweepStaleIsolatedTrialRoots({ tmpDir });
  assert.deepEqual(result.swept, [stale]);
  assert.deepEqual(result.active, [active]);
  assert.deepEqual(result.failed, []);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(active), true);
  assert.equal(fs.existsSync(foreign), true);
});

test('sweep terminates a runtime daemon recorded in a stale root pid file', async (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'full-chain-core-r1-orphan', { pid: DEAD_PID, startedAt: new Date().toISOString() });
  const stateDir = path.join(root, 'artifacts', 'desktop', 'runtime-state');
  fs.mkdirSync(stateDir, { recursive: true });
  const orphan = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore', detached: process.platform !== 'win32' });
  t.after(() => {
    try { process.kill(orphan.pid, 'SIGKILL'); } catch {}
  });
  fs.writeFileSync(path.join(stateDir, RUNTIME_DAEMON_PID_FILE), `${orphan.pid}\n`);
  const result = sweepStaleIsolatedTrialRoots({ tmpDir });
  assert.deepEqual(result.swept, [root]);
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5_000);
    orphan.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
  assert.equal(exited, true, 'sweep must terminate the recorded runtime daemon');
  assert.equal(fs.existsSync(root), false);
});

test('retained-root prune drops model payload but keeps runtime logs and audit', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const runtimeData = path.join(tmpDir, 'runtime-data');
  for (const dir of ['models/resolved/example', 'dependencies/cuda', 'environments/speech', 'logs', 'audit']) {
    fs.mkdirSync(path.join(runtimeData, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(runtimeData, 'models', 'resolved', 'example', 'model.gguf'), 'weights');
  fs.writeFileSync(path.join(runtimeData, 'logs', 'runtime.log'), 'log line');
  const result = pruneRetainedTrialRootPayload({ paths: { runtimeData } });
  assert.deepEqual(result.pruned.sort(), ['dependencies', 'environments', 'models']);
  assert.deepEqual(result.failed, []);
  assert.equal(fs.existsSync(path.join(runtimeData, 'models')), false);
  assert.equal(fs.existsSync(path.join(runtimeData, 'dependencies')), false);
  assert.equal(fs.readFileSync(path.join(runtimeData, 'logs', 'runtime.log'), 'utf8'), 'log line');
  assert.equal(fs.existsSync(path.join(runtimeData, 'audit')), true);
});

test('prune tolerates trials without a runtime-data root', () => {
  const result = pruneRetainedTrialRootPayload({ paths: { runtimeData: path.join(os.tmpdir(), 'nimi-hygiene-missing', 'runtime-data') } });
  assert.deepEqual(result, { pruned: [], failed: [] });
});
