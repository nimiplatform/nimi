// Tests for scripts/lib/release-gate/runner.mjs and runners.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  selectGates,
  topoSort,
  isVerdictPermissive,
  executeGates,
  computeProcessExitCode,
} from './runner.mjs';
import { composeSpawn, parseArgv, runByKind } from './runners.mjs';

// --- selectGates ----------------------------------------------------------

test('selectGates: tier match required', () => {
  const gates = [
    { id: 'gate.a.x', tiers: ['fast'], targets: ['any'] },
    { id: 'gate.a.y', tiers: ['release'], targets: ['any'] },
  ];
  const r = selectGates(gates, {
    tier: 'fast',
    target: 'any',
    include: [],
    filter: null,
  });
  assert.equal(r.selected.length, 1);
  assert.equal(r.selected[0].id, 'gate.a.x');
  assert.equal(r.selectedTier.get('gate.a.x'), 'fast');
});

test('selectGates: --include pulls in extra tiers', () => {
  const gates = [
    { id: 'gate.a.x', tiers: ['fast'], targets: ['any'] },
    { id: 'gate.a.y', tiers: ['live'], targets: ['any'] },
  ];
  const r = selectGates(gates, {
    tier: 'fast',
    target: 'any',
    include: ['live'],
    filter: null,
  });
  assert.equal(r.selected.length, 2);
});

test('selectGates: target filter respects "any"', () => {
  const gates = [
    { id: 'gate.a.x', tiers: ['fast'], targets: ['any'] },
    { id: 'gate.a.y', tiers: ['fast'], targets: ['runtime'] },
    { id: 'gate.a.z', tiers: ['fast'], targets: ['sdk'] },
  ];
  const r = selectGates(gates, {
    tier: 'fast',
    target: 'runtime',
    include: [],
    filter: null,
  });
  assert.equal(r.selected.length, 2);
  assert.deepEqual(r.selected.map((g) => g.id).sort(), ['gate.a.x', 'gate.a.y']);
});

test('selectGates: --filter glob', () => {
  const gates = [
    { id: 'gate.runtime.build', tiers: ['fast'], targets: ['any'] },
    { id: 'gate.sdk.build', tiers: ['fast'], targets: ['any'] },
  ];
  const r = selectGates(gates, {
    tier: 'fast',
    target: 'any',
    include: [],
    filter: 'gate.runtime.*',
  });
  assert.equal(r.selected.length, 1);
  assert.equal(r.selected[0].id, 'gate.runtime.build');
});

// --- topoSort -------------------------------------------------------------

test('topoSort: respects prerequisite order', () => {
  const gates = [
    { id: 'gate.a.b', prerequisites: ['gate.a.a'] },
    { id: 'gate.a.a', prerequisites: [] },
    { id: 'gate.a.c', prerequisites: ['gate.a.b'] },
  ];
  const order = topoSort(gates).map((g) => g.id);
  assert.deepEqual(order, ['gate.a.a', 'gate.a.b', 'gate.a.c']);
});

test('topoSort: stable tie-break by id', () => {
  const gates = [
    { id: 'gate.a.z', prerequisites: [] },
    { id: 'gate.a.a', prerequisites: [] },
    { id: 'gate.a.m', prerequisites: [] },
  ];
  const order = topoSort(gates).map((g) => g.id);
  assert.deepEqual(order, ['gate.a.a', 'gate.a.m', 'gate.a.z']);
});

// --- isVerdictPermissive --------------------------------------------------

test('isVerdictPermissive: pass always permissive', () => {
  assert.equal(isVerdictPermissive('pass', { tiers: [] }, { requireRelease: true, allowBlockedTiers: [] }), true);
});

test('isVerdictPermissive: unreachable never permissive', () => {
  assert.equal(isVerdictPermissive('unreachable', { tiers: [] }, { requireRelease: false, allowBlockedTiers: [] }), false);
});

test('isVerdictPermissive: blocked + require-release → false', () => {
  assert.equal(
    isVerdictPermissive('blocked', { tiers: ['live'] }, { requireRelease: true, allowBlockedTiers: ['live'] }),
    false
  );
});

test('isVerdictPermissive: blocked + tier in allow list → true', () => {
  assert.equal(
    isVerdictPermissive('blocked', { tiers: ['live'] }, { requireRelease: false, allowBlockedTiers: ['live'] }),
    true
  );
});

test('isVerdictPermissive: blocked + tier not in allow list → false', () => {
  assert.equal(
    isVerdictPermissive('blocked', { tiers: ['fast'] }, { requireRelease: false, allowBlockedTiers: ['live'] }),
    false
  );
});

// --- runners --------------------------------------------------------------

test('parseArgv: simple words', () => {
  assert.deepEqual(parseArgv('a b c'), ['a', 'b', 'c']);
});

test('parseArgv: quoted strings preserved', () => {
  assert.deepEqual(parseArgv('a "b c" d'), ['a', 'b c', 'd']);
});

test('parseArgv: single-quoted preserves', () => {
  assert.deepEqual(parseArgv("a 'b c' d"), ['a', 'b c', 'd']);
});

test('composeSpawn: pnpm runner strips leading "pnpm "', () => {
  const r = composeSpawn({ id: 'gate.x.y', runner: 'pnpm', command: 'pnpm proto:lint' });
  assert.equal(r.command, 'pnpm');
  assert.deepEqual(r.args, ['proto:lint']);
});

test('composeSpawn: pnpm runner wraps Windows command shim when enabled', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-pnpm-'));
  try {
    fs.writeFileSync(path.join(tmp, 'pnpm.cmd'), '@echo off\r\nexit /b 0\r\n');
    const r = composeSpawn(
      { id: 'gate.x.y', runner: 'pnpm', command: 'pnpm proto:lint --check' },
      {
        env: { PATH: tmp, PATHEXT: '.CMD' },
        platform: 'win32',
        resolveCommandShims: true,
      }
    );
    assert.match(r.command, /cmd(?:\.exe)?$/i);
    assert.deepEqual(r.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(r.args[3], /pnpm\.cmd/);
    assert.match(r.args[3], / proto:lint --check$/);
    assert.equal(r.windowsVerbatimArguments, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('composeSpawn: pnpm runner preserves Windows command shim args with spaces', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-pnpm-space-'));
  try {
    fs.writeFileSync(path.join(tmp, 'pnpm.cmd'), '@echo off\r\nexit /b 0\r\n');
    const r = composeSpawn(
      { id: 'gate.x.y', runner: 'pnpm', command: 'pnpm exec "hello world"' },
      {
        env: { PATH: tmp, PATHEXT: '.CMD' },
        platform: 'win32',
        resolveCommandShims: true,
      }
    );
    assert.match(r.args[3], /^""/);
    assert.match(r.args[3], / exec "hello world""$/);
    assert.match(r.args[3], /""$/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('composeSpawn: node runner strips leading "node "', () => {
  const r = composeSpawn({
    id: 'gate.x.y',
    runner: 'node',
    command: 'node scripts/foo.mjs --bar',
  });
  assert.equal(r.command, 'node');
  assert.deepEqual(r.args, ['scripts/foo.mjs', '--bar']);
});

test('composeSpawn: go runner strips leading "go "', () => {
  const r = composeSpawn({ id: 'gate.x.y', runner: 'go', command: 'go build ./...' });
  assert.equal(r.command, 'go');
  assert.deepEqual(r.args, ['build', './...']);
});

test('composeSpawn: shell runner wraps in bash -c with pipefail', () => {
  const r = composeSpawn({
    id: 'gate.x.y',
    runner: 'shell',
    command: 'echo hi | grep h',
  });
  assert.match(r.command, /bash(?:\.exe)?$/i);
  assert.equal(r.args[0], '-c');
  assert.match(r.args[1], /set -o pipefail; echo hi \| grep h/);
});

test('composeSpawn: shell runner uses explicit bash path on Windows', () => {
  const explicitBash = 'C:\\Tools\\Git\\bin\\bash.exe';
  const r = composeSpawn(
    {
      id: 'gate.x.y',
      runner: 'shell',
      command: 'test -s runtime/proto/runtime-v1.baseline.binpb',
    },
    {
      env: { NIMI_RELEASE_GATE_BASH: explicitBash },
      platform: 'win32',
    }
  );
  assert.equal(r.command, explicitBash);
  assert.deepEqual(r.args, [
    '-c',
    'set -o pipefail; test -s runtime/proto/runtime-v1.baseline.binpb',
  ]);
});

test('composeSpawn: pnpm without leading pnpm rejected', () => {
  assert.throws(() =>
    composeSpawn({ id: 'gate.x.y', runner: 'pnpm', command: 'go build' })
  );
});

test('composeSpawn: unknown runner rejected', () => {
  assert.throws(() =>
    composeSpawn({ id: 'gate.x.y', runner: 'bash', command: 'echo' })
  );
});

// --- runByKind (real spawn, fast cases) -----------------------------------

test('runByKind shell: exit 0 captured', { timeout: 10000 }, async () => {
  const result = await runByKind({
    id: 'gate.test.x',
    runner: 'shell',
    command: 'echo hello',
    timeout_seconds: 5,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout.toString('utf8'), /hello/);
});

test('runByKind shell: exit non-zero captured', { timeout: 10000 }, async () => {
  const result = await runByKind({
    id: 'gate.test.x',
    runner: 'shell',
    command: 'exit 42',
    timeout_seconds: 5,
  });
  assert.equal(result.exitCode, 42);
  assert.equal(result.timedOut, false);
});

test('runByKind shell: timeout enforces SIGKILL', { timeout: 10000 }, async () => {
  const result = await runByKind({
    id: 'gate.test.x',
    runner: 'shell',
    command: 'sleep 30',
    timeout_seconds: 1,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
});

test('runByKind shell: piped command honors pipefail', { timeout: 10000 }, async () => {
  // false | true would normally exit 0 without pipefail; with pipefail → 1
  const result = await runByKind({
    id: 'gate.test.x',
    runner: 'shell',
    command: 'false | true',
    timeout_seconds: 5,
  });
  assert.equal(result.exitCode, 1);
});

test('runByKind: bounded stderr line observer receives complete lines', { timeout: 10000 }, async () => {
  const lines = [];
  const result = await runByKind(
    {
      id: 'gate.test.stderr-lines',
      runner: 'shell',
      command: `printf '[runtime-compliance] phase=tests item=pkg\\npartial' >&2`,
      timeout_seconds: 5,
    },
    { onStderrLine: (line) => lines.push(line) }
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(lines, [
    '[runtime-compliance] phase=tests item=pkg',
    'partial',
  ]);
});

test('executeGates: runtime compliance progress streams without unrelated stderr', { timeout: 10000 }, async () => {
  const live = [];
  const gates = [{
    id: 'gate.runtime.compliance',
    runner: 'shell',
    command: `printf '[runtime-compliance] phase=tests item=pkg\\nnoise\\n' >&2`,
    tiers: ['release'],
    targets: ['runtime'],
    timeout_seconds: 5,
    prerequisites: [],
  }];
  const result = await executeGates({
    gates,
    selectedTier: new Map([['gate.runtime.compliance', 'release']]),
    options: {
      target: 'runtime',
      color: false,
      requireRelease: true,
      allowBlockedTiers: [],
    },
    onLiveProgress: (line) => live.push(line),
  });
  assert.equal(result.rows[0].verdict, 'pass');
  assert.deepEqual(live, ['[runtime-compliance] phase=tests item=pkg\n']);
});

test('runByKind pnpm: Windows command shim executes through cmd wrapper', { timeout: 10000, skip: process.platform !== 'win32' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-run-pnpm-'));
  try {
    fs.writeFileSync(
      path.join(tmp, 'pnpm.cmd'),
      '@echo off\r\necho fake-pnpm %*\r\nexit /b 0\r\n'
    );
    const result = await runByKind(
      {
        id: 'gate.test.pnpm-shim',
        runner: 'pnpm',
        command: 'pnpm --version',
        timeout_seconds: 5,
      },
      {
        env: { PATH: tmp, PATHEXT: '.CMD' },
      }
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.spawnedCommand, /cmd(?:\.exe)?$/i);
    assert.match(result.stdout.toString('utf8'), /fake-pnpm --version/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- executeGates (synthetic) ---------------------------------------------

test('executeGates: pass + unreachable cascade', { timeout: 10000 }, async () => {
  const gates = [
    { id: 'gate.test.a', runner: 'shell', command: 'true', tiers: ['fast'], targets: ['any'], timeout_seconds: 5, prerequisites: [] },
    { id: 'gate.test.b', runner: 'shell', command: 'false', tiers: ['fast'], targets: ['any'], timeout_seconds: 5, prerequisites: [] },
    { id: 'gate.test.c', runner: 'shell', command: 'true', tiers: ['fast'], targets: ['any'], timeout_seconds: 5, prerequisites: ['gate.test.b'] },
  ];
  const selectedTier = new Map(gates.map((g) => [g.id, 'fast']));
  const options = {
    tier: 'fast',
    target: 'any',
    include: [],
    allowBlockedTiers: [],
    requireRelease: false,
    color: false,
  };
  const { rows } = await executeGates({ gates, selectedTier, options });
  const byId = Object.fromEntries(rows.map((r) => [r.gate_id, r]));
  assert.equal(byId['gate.test.a'].verdict, 'pass');
  assert.equal(byId['gate.test.b'].verdict, 'fail');
  assert.equal(byId['gate.test.c'].verdict, 'unreachable');
  assert.equal(byId['gate.test.c'].blocker_reason_code, 'UPSTREAM_GATE_FAILED');
});

test('executeGates: blocked on missing secret', { timeout: 10000 }, async () => {
  const gates = [
    {
      id: 'gate.test.x',
      runner: 'shell',
      command: 'true',
      tiers: ['fast'],
      targets: ['any'],
      timeout_seconds: 5,
      requires_secrets: ['NIMI_PROBE_NONEXISTENT_SECRET_12345'],
    },
  ];
  const selectedTier = new Map([['gate.test.x', 'fast']]);
  const { rows } = await executeGates({
    gates,
    selectedTier,
    options: {
      tier: 'fast',
      target: 'any',
      include: [],
      allowBlockedTiers: [],
      requireRelease: false,
      color: false,
    },
  });
  assert.equal(rows[0].verdict, 'blocked');
  assert.equal(rows[0].blocker_reason_code, 'SECRETS_MISSING');
});

test('executeGates: blocked on skip_when local precondition', { timeout: 10000 }, async () => {
  const gates = [
    {
      id: 'gate.test.x',
      runner: 'shell',
      command: 'false',
      tiers: ['fast'],
      targets: ['any'],
      timeout_seconds: 5,
      skip_when: { condition: 'local', reason_code: 'PRECONDITION_NOT_MET' },
    },
  ];
  const selectedTier = new Map([['gate.test.x', 'fast']]);
  const { rows } = await executeGates({
    gates,
    selectedTier,
    options: {
      tier: 'fast',
      target: 'any',
      include: [],
      allowBlockedTiers: [],
      requireRelease: false,
      color: false,
    },
  });
  assert.equal(rows[0].verdict, 'blocked');
  assert.equal(rows[0].blocker_reason_code, 'PRECONDITION_NOT_MET');
});

// --- computeProcessExitCode -----------------------------------------------

test('computeProcessExitCode: fail → 1', () => {
  const rows = [{ gate_id: 'g.a.x', verdict: 'fail' }];
  const code = computeProcessExitCode({
    rows,
    gatesById: new Map([['g.a.x', { tiers: ['fast'] }]]),
    options: { requireRelease: false, allowBlockedTiers: [] },
  });
  assert.equal(code, 1);
});

test('computeProcessExitCode: blocked + require-release → 1', () => {
  const rows = [{ gate_id: 'g.a.x', verdict: 'blocked' }];
  const code = computeProcessExitCode({
    rows,
    gatesById: new Map([['g.a.x', { tiers: ['live'] }]]),
    options: { requireRelease: true, allowBlockedTiers: [] },
  });
  assert.equal(code, 1);
});

test('computeProcessExitCode: blocked + tier in allow list → 0', () => {
  const rows = [{ gate_id: 'g.a.x', verdict: 'blocked' }];
  const code = computeProcessExitCode({
    rows,
    gatesById: new Map([['g.a.x', { tiers: ['live'] }]]),
    options: { requireRelease: false, allowBlockedTiers: ['live'] },
  });
  assert.equal(code, 0);
});

test('computeProcessExitCode: precondition blocked is permitted outside require-release', () => {
  const rows = [{ gate_id: 'g.a.x', verdict: 'blocked', blocker_reason_code: 'PRECONDITION_NOT_MET' }];
  const code = computeProcessExitCode({
    rows,
    gatesById: new Map([['g.a.x', { tiers: ['release'] }]]),
    options: { requireRelease: false, allowBlockedTiers: [] },
  });
  assert.equal(code, 0);
});

test('computeProcessExitCode: all pass → 0', () => {
  const rows = [{ gate_id: 'g.a.x', verdict: 'pass' }];
  const code = computeProcessExitCode({
    rows,
    gatesById: new Map([['g.a.x', { tiers: ['fast'] }]]),
    options: { requireRelease: false, allowBlockedTiers: [] },
  });
  assert.equal(code, 0);
});
