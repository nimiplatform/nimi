// E2E test for scripts/release-preflight.mjs.
//
// Spawns the entry point against a synthetic 3-gate registry, then
// verifies the produced evidence JSON conforms to release-gate-evidence/v1
// and the exit code follows L4/L5 rules.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(REPO_ROOT, 'scripts', 'release-preflight.mjs');

const SYNTHETIC_REGISTRY = `schema_version: release-gate-registry/v1
registry_version: "0.0.1"
profile_id: nimi
generated_at: 2026-05-10T00:00:00Z

tiers:
  - id: fast
    semantic: x
  - id: release
    semantic: y

targets:
  - any

reason_codes:
  - id: COMMAND_NONZERO
    semantic: x
  - id: SECRETS_MISSING
    semantic: y

gates:
  - id: gate.test.passing
    description: pass case
    command: "true"
    runner: shell
    tiers: [fast, release]
    targets: [any]
    timeout_seconds: 10
    p_relg_anchors: [P-RELG-001]
    parent_p_gov_anchors: [P-GOV-003]
    evidence:
      shape: command_exit
    experimental: false

  - id: gate.test.failing
    description: fail case
    command: "false"
    runner: shell
    tiers: [fast, release]
    targets: [any]
    timeout_seconds: 10
    p_relg_anchors: [P-RELG-001]
    parent_p_gov_anchors: [P-GOV-003]
    evidence:
      shape: command_exit
    experimental: false

  - id: gate.test.cascaded
    description: should be unreachable
    command: "true"
    runner: shell
    tiers: [fast, release]
    targets: [any]
    timeout_seconds: 10
    prerequisites: [gate.test.failing]
    p_relg_anchors: [P-RELG-001]
    parent_p_gov_anchors: [P-GOV-003]
    evidence:
      shape: command_exit
    experimental: false
`;

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

test('release-preflight against synthetic registry: green-with-fail → exit 1', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-e2e-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const evidenceOut = path.join(tmp, 'evidence.json');

    const r = await runEntry(
      [
        '--registry-path',
        registryPath,
        '--tier',
        'fast',
        '--target',
        'any',
        '--evidence-out',
        evidenceOut,
        '--no-color',
      ],
      { cwd: tmp }
    );

    // 1 fail + 1 unreachable → exit 1 per L4
    assert.equal(r.code, 1);

    // Evidence file exists and has correct schema_version
    const text = fs.readFileSync(evidenceOut, 'utf8');
    const doc = JSON.parse(text);
    assert.equal(doc.schema_version, 'release-gate-evidence/v1');
    assert.equal(doc.profile_id, 'nimi');
    assert.equal(doc.gates.length, 3);

    const byId = Object.fromEntries(doc.gates.map((g) => [g.gate_id, g]));
    assert.equal(byId['gate.test.passing'].verdict, 'pass');
    assert.equal(byId['gate.test.failing'].verdict, 'fail');
    assert.equal(byId['gate.test.failing'].blocker_reason_code, 'COMMAND_NONZERO');
    assert.equal(byId['gate.test.cascaded'].verdict, 'unreachable');
    assert.equal(byId['gate.test.cascaded'].blocker_reason_code, 'UPSTREAM_GATE_FAILED');

    // Summary correct
    assert.equal(doc.summary.pass_count, 1);
    assert.equal(doc.summary.fail_count, 1);
    assert.equal(doc.summary.unreachable_count, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('release-preflight: --filter narrows gate set', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-e2e-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const evidenceOut = path.join(tmp, 'evidence.json');

    const r = await runEntry(
      [
        '--registry-path',
        registryPath,
        '--tier',
        'fast',
        '--filter',
        'gate.test.passing',
        '--evidence-out',
        evidenceOut,
        '--no-color',
      ],
      { cwd: tmp }
    );

    assert.equal(r.code, 0);
    const doc = JSON.parse(fs.readFileSync(evidenceOut, 'utf8'));
    assert.equal(doc.gates.length, 1);
    assert.equal(doc.gates[0].gate_id, 'gate.test.passing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('release-preflight: rejects --require-release + --allow-blocked-tiers', { timeout: 5000 }, async () => {
  const r = await runEntry(['--require-release', '--allow-blocked-tiers', 'live']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /forbids/);
});

test('release-preflight: empty match → exit 1', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-e2e-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const r = await runEntry(
      [
        '--registry-path',
        registryPath,
        '--tier',
        'release',
        '--filter',
        'gate.does-not-exist.*',
        '--no-color',
      ],
      { cwd: tmp }
    );
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no gates matched/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
