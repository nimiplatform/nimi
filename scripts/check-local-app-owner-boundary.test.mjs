import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gateRelative = 'scripts/check-local-app-owner-boundary.mjs';
const bundleFiles = [
  gateRelative,
  '.nimi/spec/runtime/kernel/account-session-contract.md',
  '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
  '.nimi/spec/platform/kernel/kit-contract.md',
  '.nimi/spec/platform/kernel/app-permission-contract.md',
  '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml',
  '.nimi/spec/canonical/desktop/shell-runtime.authority.yaml',
];

const expectedFixtureCodes = [
  'RUNTIME_REALM_OWNER_MISSING',
  'ZERO_PERMISSION_BOUNDARY_MISSING',
  'IMMUTABLE_PROVENANCE_UNAVAILABLE_MISSING',
  'REALM_EXACT_SOURCE_READINESS_AUTHORITY_MISSING',
  'REALM_FALLBACK_DENIAL_MISSING',
  'PORTABLE_BLANKET_AUTHORITY_DENIAL_MISSING',
  'NATIVE_CHANNEL_AUTHORITY_MISSING',
  'APP_SELF_AUTHORIZATION_DENIAL_MISSING',
  'IMMUTABLE_PACKAGE_UNAVAILABLE_MISSING',
  'DIRECT_RUNTIME_LAUNCH_DENIAL_MISSING',
  'REQUEST_EMPTY_LOCAL_APP_CARRIER_MISSING',
  'APP_PRIVATE_STORAGE_BASE_ENTITLEMENT_MISSING',
  'AUTHORITY_CLASS_EXCLUSIVITY_MISSING',
  'ATOMIC_PERMISSION_ADMISSION_MISSING',
  'DESKTOP_CREDENTIAL_CUSTODY_DENIAL_MISSING',
  'AUTH_BINDING_OWNER_INVALID',
];

function runGate(root, args = []) {
  return spawnSync(process.execPath, [path.join(root, gateRelative), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

async function makeFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-app-owner-boundary-'));
  for (const relative of bundleFiles) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(repoRoot, relative), target);
  }
  return root;
}

async function mutateAndReject(relative, from, to, code) {
  const root = await makeFixtureRoot();
  try {
    const target = path.join(root, relative);
    const source = await fs.readFile(target, 'utf8');
    const changed = source.replace(from, to);
    assert.notEqual(changed, source, `fixture marker missing in ${relative}`);
    await fs.writeFile(target, changed, 'utf8');
    const result = runGate(root);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.match(result.stderr, new RegExp(code, 'u'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('baseline and independent negative fixtures bind the final local-app authority', () => {
  const result = runGate(repoRoot, ['--fixture-report-json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.fixtures.map((fixture) => fixture.code), expectedFixtureCodes);
  assert.equal(new Set(report.fixtures.map((fixture) => fixture.fixtureId)).size, expectedFixtureCodes.length);
  for (const fixture of report.fixtures) assert.match(fixture.reason, /\S/u);
});

test('rejects widening a zero-permission session into protected authority', async () => {
  await mutateAndReject(
    '.nimi/spec/runtime/kernel/account-session-contract.md',
    'session is valid origin proof and may use only base entitlements',
    'session is valid origin proof and may use protected resources',
    'ZERO_PERMISSION_BOUNDARY_MISSING',
  );
});

test('rejects positive immutable package behavior before 0P', async () => {
  await mutateAndReject(
    '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    'Immutable positive package behavior remains unavailable until 0P.',
    'Immutable positive package behavior is available before 0P.',
    'IMMUTABLE_PACKAGE_UNAVAILABLE_MISSING',
  );
});

test('rejects host-owned local-app session binding', async () => {
  await mutateAndReject(
    '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml',
    'runtime_owned_request_empty_local_app_session',
    'host_owned_local_app_session',
    'AUTH_BINDING_OWNER_INVALID',
  );
});
