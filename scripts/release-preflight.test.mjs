// E2E test for scripts/release-preflight.mjs.
//
// Spawns the entry point and verifies release-mode fail-closed CLI
// behavior before any gate execution.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(REPO_ROOT, 'scripts', 'release-preflight.mjs');

function runEntry(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (c) => stdout.push(c));
    child.stderr.on('data', (c) => stderr.push(c));
    child.on('close', (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    );
  });
}

test('release-preflight --help exits 0', { timeout: 5000 }, async () => {
  const r = await runEntry(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage:/);
});

test('release-preflight: rejects --require-release + --allow-blocked-tiers', { timeout: 5000 }, async () => {
  const r = await runEntry(['--require-release', '--allow-blocked-tiers', 'live']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /forbids/);
});

test('release-preflight: rejects --require-release + --filter', { timeout: 5000 }, async () => {
  const r = await runEntry(['--require-release', '--filter', 'gate.release-gate.*']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /forbids --filter/);
});

test('release-preflight: rejects caller-supplied registry path', { timeout: 5000 }, async () => {
  const r = await runEntry(['--registry-path', '/tmp/registry.yaml']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown argument: --registry-path/);
});

test('release-preflight: rejects caller-supplied evidence path', { timeout: 5000 }, async () => {
  const r = await runEntry(['--evidence-out', '/tmp/evidence.json']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown argument: --evidence-out/);
});
