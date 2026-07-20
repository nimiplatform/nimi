import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  HARNESS_OWNER_MARKER,
  RUNTIME_DAEMON_PID_FILE,
  TRIAL_IDENTITY_FILE,
  TRIAL_PROCESS_IDENTITY_FILE,
  TRIAL_ROOT_PREFIX,
  isStaleTrialRoot,
  pruneRetainedTrialRootPayload,
  registerTrialProcessIdentity,
  sweepStaleIsolatedTrialRoots,
  writeHarnessOwnerMarker,
} from './sandbox-hygiene.mjs';

const DEAD_PID = 999_999_999;

function makeFakeTmpDir(t) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-hygiene-test-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  return tmpDir;
}

function makeTrialRoot(tmpDir, name, { owner = 'live' } = {}) {
  const root = path.join(tmpDir, `${TRIAL_ROOT_PREFIX}${name}`);
  const candidateId = `candidate:${name}`;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, TRIAL_IDENTITY_FILE), `${JSON.stringify({ candidateId })}\n`);
  writeHarnessOwnerMarker(root, { candidateId });
  if (owner === 'dead') markOwnerDead(root);
  return root;
}

function markOwnerDead(root) {
  const markerFile = path.join(root, HARNESS_OWNER_MARKER);
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  fs.writeFileSync(markerFile, `${JSON.stringify({ ...marker, pid: DEAD_PID, creationTime: 'dead-owner' })}\n`);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function spawnIdleNode(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  t.after(() => {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
  });
  return child;
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

test('trial roots with a dead harness owner identity are stale regardless of age', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'dead-owner', { owner: 'dead' });
  assert.equal(isStaleTrialRoot(root), true);
});

test('trial roots with a live recent owner identity are not stale', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'live-owner');
  assert.equal(isStaleTrialRoot(root), false);
});

test('a live legacy owner marker is retained for another session', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = path.join(tmpDir, `${TRIAL_ROOT_PREFIX}legacy-live-owner`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, HARNESS_OWNER_MARKER), `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-harness-owner/v1',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  })}\n`);
  assert.equal(isStaleTrialRoot(root), false);
  const result = sweepStaleIsolatedTrialRoots({ tmpDir });
  assert.deepEqual(result.active, [root]);
  assert.equal(fs.existsSync(root), true);
});

test('a mismatched v2 owner marker is retained and fails cleanup closed', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'marker-root-mismatch', { owner: 'dead' });
  const markerFile = path.join(root, HARNESS_OWNER_MARKER);
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  fs.writeFileSync(markerFile, `${JSON.stringify({ ...marker, trialRootHash: '0'.repeat(64) })}\n`);
  const result = sweepStaleIsolatedTrialRoots({ tmpDir });
  assert.deepEqual(result.swept, []);
  assert.equal(result.failed[0]?.code, 'TRIAL_OWNER_MARKER_IDENTITY_MISMATCH');
  assert.equal(fs.existsSync(root), true);
});

test('markerless trial roots go stale by age only', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = path.join(tmpDir, `${TRIAL_ROOT_PREFIX}markerless`);
  fs.mkdirSync(root, { recursive: true });
  assert.equal(isStaleTrialRoot(root, { maxAgeMs: 60_000 }), false);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(root, old, old);
  assert.equal(isStaleTrialRoot(root, { maxAgeMs: 60_000 }), true);
});

test('writeHarnessOwnerMarker binds owner identity to root hash and candidate', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = path.join(tmpDir, `${TRIAL_ROOT_PREFIX}marker`);
  const candidateId = 'candidate:marker';
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, TRIAL_IDENTITY_FILE), `${JSON.stringify({ candidateId })}\n`);
  const marker = writeHarnessOwnerMarker(root, { candidateId });
  assert.equal(marker.schemaVersion, 'nimi.local-agent-harness-owner/v2');
  assert.equal(marker.pid, process.pid);
  assert.equal(marker.candidateId, candidateId);
  const canonicalRoot = fs.realpathSync.native(root);
  assert.equal(marker.trialRoot, process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot);
  assert.match(marker.trialRootHash, /^[a-f0-9]{64}$/u);
  assert.ok(marker.creationTime);
  assert.ok(marker.executablePath);
  assert.ok(marker.commandLine);
});

test('sweep removes stale roots, keeps active roots, and ignores foreign directories', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const stale = makeTrialRoot(tmpDir, 'full-chain-core-r1-stale', { owner: 'dead' });
  const active = makeTrialRoot(tmpDir, 'full-chain-core-r1-active');
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

test('a retired bare runtime-daemon pid file cannot authorize process termination', async (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'bare-pid-is-not-authority', { owner: 'dead' });
  const stateDir = path.join(root, 'artifacts', 'desktop', 'runtime-state');
  fs.mkdirSync(stateDir, { recursive: true });
  const unrelated = spawnIdleNode(t);
  fs.writeFileSync(path.join(stateDir, RUNTIME_DAEMON_PID_FILE), `${unrelated.pid}\n`);
  const result = sweepStaleIsolatedTrialRoots({ tmpDir });
  assert.deepEqual(result.swept, [root]);
  assert.equal(processAlive(unrelated.pid), true, 'bare PID files must not grant kill authority');
  assert.equal(await Promise.race([waitForExit(unrelated, 100), Promise.resolve(false)]), false);
});

test('sweep terminates only an exact registered trial process identity', async (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'registered-orphan');
  const child = spawnIdleNode(t);
  const registration = registerTrialProcessIdentity(root, child, 'desktop-shell');
  assert.equal(registration.pid, child.pid);
  markOwnerDead(root);

  const result = sweepStaleIsolatedTrialRoots({ tmpDir });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.swept, [root]);
  assert.equal(await waitForExit(child), true, 'exact registered identity must be terminated');
});

test('sweep retains a stale root and refuses a PID whose creation identity changed', (t) => {
  const tmpDir = makeFakeTmpDir(t);
  const root = makeTrialRoot(tmpDir, 'pid-reuse-refused');
  const child = spawnIdleNode(t);
  registerTrialProcessIdentity(root, child, 'zhiyu-shell');
  const ledgerFile = path.join(root, TRIAL_PROCESS_IDENTITY_FILE);
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  ledger.processes[0].creationTime = `${ledger.processes[0].creationTime}:different`;
  fs.writeFileSync(ledgerFile, `${JSON.stringify(ledger)}\n`);
  markOwnerDead(root);

  const result = sweepStaleIsolatedTrialRoots({ tmpDir });
  assert.deepEqual(result.swept, []);
  assert.equal(result.failed[0]?.code, 'PROCESS_IDENTITY_MISMATCH');
  assert.equal(fs.existsSync(root), true);
  assert.equal(processAlive(child.pid), true);
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
