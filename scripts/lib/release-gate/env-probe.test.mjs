// Tests for scripts/lib/release-gate/env-probe.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  evaluateSkipWhen,
  isSecretAvailable,
  isEnvAvailable,
  isExternalRepoAvailable,
  isBinaryAvailable,
  probeGateEnvironment,
  translateProbeVerdict,
  captureHostEnvironment,
} from './env-probe.mjs';

test('isSecretAvailable: present non-empty value → true', () => {
  assert.equal(isSecretAvailable('FOO', { FOO: 'bar' }), true);
});

test('isSecretAvailable: missing key → false', () => {
  assert.equal(isSecretAvailable('FOO', {}), false);
});

test('isSecretAvailable: empty string → false', () => {
  assert.equal(isSecretAvailable('FOO', { FOO: '' }), false);
});

test('isEnvAvailable: present non-empty value → true', () => {
  assert.equal(isEnvAvailable('FOO', { FOO: 'bar' }), true);
});

test('isExternalRepoAvailable: existing dir → true', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-probe-'));
  try {
    const inner = path.join(tmp, 'sub');
    fs.mkdirSync(inner);
    assert.equal(isExternalRepoAvailable('sub', tmp), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isExternalRepoAvailable: missing dir → false', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-probe-'));
  try {
    assert.equal(isExternalRepoAvailable('does-not-exist', tmp), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isExternalRepoAvailable: absolute path → false (D2 schema requires relative)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-probe-'));
  try {
    assert.equal(isExternalRepoAvailable(tmp, tmp), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isBinaryAvailable: real binary (node) → true', () => {
  assert.equal(isBinaryAvailable('node'), true);
});

test('isBinaryAvailable: nonsense binary → false', () => {
  assert.equal(isBinaryAvailable('nimi-bogus-binary-12345'), false);
});

test('isBinaryAvailable: Windows PATH resolves PATHEXT command shims', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-probe-bin-'));
  try {
    const binaryName = 'nimi-fake-release-tool';
    fs.writeFileSync(path.join(tmp, `${binaryName}.cmd`), '@echo off\r\nexit /b 0\r\n');
    assert.equal(
      isBinaryAvailable(binaryName, { PATH: tmp, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32'),
      true
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('probeGateEnvironment: ok=true when nothing required', () => {
  const gate = { id: 'gate.test.x' };
  const r = probeGateEnvironment(gate, {}, process.cwd());
  assert.equal(r.ok, true);
});

test('probeGateEnvironment: missing secret reported', () => {
  const gate = { id: 'gate.test.x', requires_secrets: ['MY_SECRET_FOO'] };
  const r = probeGateEnvironment(gate, {}, process.cwd());
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.secrets, ['MY_SECRET_FOO']);
});

test('probeGateEnvironment: missing required env reported', () => {
  const gate = { id: 'gate.test.x', requires_env: ['MY_ENV_FOO'] };
  const r = probeGateEnvironment(gate, {}, process.cwd());
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.env, ['MY_ENV_FOO']);
});

test('probeGateEnvironment: missing binary reported', () => {
  const gate = {
    id: 'gate.test.x',
    requires_binaries: ['nimi-bogus-binary-12345'],
  };
  const r = probeGateEnvironment(gate, {}, process.cwd());
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.binaries, ['nimi-bogus-binary-12345']);
});

test('translateProbeVerdict: ok probe → null', () => {
  assert.equal(translateProbeVerdict({}, { ok: true, missing: { secrets: [], env: [], externalRepos: [], binaries: [] } }), null);
});

test('translateProbeVerdict: missing env defaults to blocked required state', () => {
  const gate = { id: 'gate.test.x' };
  const probe = { ok: false, missing: { secrets: [], env: ['NIMI_ARTIFACT_PATHS_JSON'], externalRepos: [], binaries: [] } };
  const r = translateProbeVerdict(gate, probe);
  assert.equal(r.verdict, 'blocked');
  assert.equal(r.blockerReasonCode, 'REQUIRED_STATE_MISSING');
});

test('translateProbeVerdict: missing secret defaults to blocked', () => {
  const gate = { id: 'gate.test.x' };
  const probe = { ok: false, missing: { secrets: ['X'], externalRepos: [], binaries: [] } };
  const r = translateProbeVerdict(gate, probe);
  assert.equal(r.verdict, 'blocked');
  assert.equal(r.blockerReasonCode, 'SECRETS_MISSING');
});

test('translateProbeVerdict: blocker_semantics:fail policy → fail', () => {
  const gate = { id: 'gate.test.x', blocker_semantics: { on_secrets_missing: 'fail' } };
  const probe = { ok: false, missing: { secrets: ['X'], externalRepos: [], binaries: [] } };
  const r = translateProbeVerdict(gate, probe);
  assert.equal(r.verdict, 'fail');
  assert.equal(r.blockerReasonCode, 'SECRETS_MISSING');
});

test('translateProbeVerdict: missing external repo → blocked default', () => {
  const gate = { id: 'gate.test.x' };
  const probe = { ok: false, missing: { secrets: [], externalRepos: ['external-tools'], binaries: [] } };
  const r = translateProbeVerdict(gate, probe);
  assert.equal(r.verdict, 'blocked');
  assert.equal(r.blockerReasonCode, 'EXTERNAL_REPO_UNAVAILABLE');
});

test('translateProbeVerdict: missing binary → blocked default', () => {
  const gate = { id: 'gate.test.x' };
  const probe = { ok: false, missing: { secrets: [], externalRepos: [], binaries: ['cargo'] } };
  const r = translateProbeVerdict(gate, probe);
  assert.equal(r.verdict, 'blocked');
  assert.equal(r.blockerReasonCode, 'BINARY_MISSING');
});

test('captureHostEnvironment: returns expected shape', () => {
  const r = captureHostEnvironment({});
  assert.match(r.os, /^[a-z0-9]+-/);
  assert.match(r.node_version, /^v\d+/);
  assert.equal(typeof r.ci, 'boolean');
});

test('captureHostEnvironment: Windows PATH resolves pnpm command shim version', { skip: process.platform !== 'win32' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-probe-pnpm-'));
  try {
    fs.writeFileSync(path.join(tmp, 'pnpm.cmd'), '@echo off\r\necho 99.0.0\r\nexit /b 0\r\n');
    const r = captureHostEnvironment({ PATH: tmp, PATHEXT: '.CMD' });
    assert.equal(r.pnpm_version, '99.0.0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('evaluateSkipWhen: local condition blocks outside CI', () => {
  const r = evaluateSkipWhen({ skip_when: { condition: 'local', reason_code: 'PRECONDITION_NOT_MET' } }, {});
  assert.equal(r.verdict, 'blocked');
  assert.equal(r.blockerReasonCode, 'PRECONDITION_NOT_MET');
});
