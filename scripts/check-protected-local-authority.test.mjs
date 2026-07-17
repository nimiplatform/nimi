import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  AUTHORITY_PATHS,
  MODES,
  loadAuthorityBundle,
  runNegativeFixtures,
  validateAllModes,
} from './lib/protected-local-authority-check.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gatePath = path.join(scriptDir, 'check-protected-local-authority.mjs');
const fixtures = JSON.parse(fs.readFileSync(
  path.join(scriptDir, 'testdata/protected-local-authority/negative-fixtures.json'),
  'utf8',
));

const expectedCodes = [
  'RETIRED_PUBLIC_VOCABULARY_FORBIDDEN',
  'SID_PARTITION_REQUIRED',
  'PRINCIPAL_RECORD_STORE_SEPARATION_REQUIRED',
  'GRANT_STORE_SEPARATION_REQUIRED',
  'PRESENCE_AUTHORITY_BINDING_REQUIRED',
  'FIXED_WINDOWS_SERVICE_REQUIRED',
  'SERVICE_ACCEPTANCE_ISOLATION_REQUIRED',
  'OPAQUE_PACKAGE_SEAM_REQUIRED',
  'PACKAGE_METHODS_MUST_BE_UNAVAILABLE',
  'FINAL_TRANSPORT_CLASSES_REQUIRED',
  'FINAL_ORIGIN_ROLES_REQUIRED',
  'LOCAL_APP_SESSION_WIRE_REQUIRED',
  'LOCAL_APP_ROUTE_POSTURE_REQUIRED',
  'DESKTOP_PRODUCT_CONTROL_ROUTE_CONVERGENCE_REQUIRED',
  'PORTABLE_AUTHORITY_FORBIDDEN',
  'TRUST_SET_ISOLATION_REQUIRED',
];

function runGate(args) {
  return spawnSync(process.execPath, [gatePath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function parseAuthority(relative) {
  return YAML.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
}

test('the repository authority bundle is the positive 0K fixture', () => {
  const issues = validateAllModes(loadAuthorityBundle(repoRoot));
  assert.deepEqual(issues, []);
});

test('the final transport, role, and request-empty local session shapes are exact', () => {
  const matrix = parseAuthority(AUTHORITY_PATHS.transport);
  assert.deepEqual(matrix.transport_classes, [
    'public_tcp',
    'desktop_control',
    'local_app_bootstrap',
    'local_app_host',
  ]);
  assert.deepEqual(matrix.origin_roles, [
    'binding_only',
    'verified_desktop_process',
    'desktop_account_host',
    'local_app_control',
    'local_app_process',
    'local_app_session',
  ]);
  assert.deepEqual(matrix.open_local_app_session_wire.request.fields, []);
  assert.deepEqual(matrix.open_local_app_session_wire.request.request_metadata_authority_inputs, []);
  assert.equal(matrix.open_local_app_session_wire.request.unknown_field_disposition, 'reject');
  assert.equal(matrix.open_local_app_session_wire.atomic_transition, 'launch_lease_consume_and_private_local_app_session_insert');
  const open = matrix.methods.find((row) => row.method_id.endsWith('/OpenLocalAppSession'));
  assert.deepEqual(open.allowed_transport_classes, ['local_app_bootstrap']);
  assert.deepEqual(open.required_origin_roles, ['local_app_process']);
});

test('SID anchor and principal, record, and grant stores are structurally separate', () => {
  const identity = parseAuthority(AUTHORITY_PATHS.principalRecord);
  const grant = parseAuthority(AUTHORITY_PATHS.grant);
  assert.equal(identity.local_os_user_anchor.platform_profile_ref, 'protected-local-os-profiles.yaml#same-os');
  assert.equal(identity.local_os_user_anchor.profile_field, 'local_os_user_anchor_derivation');
  assert.equal(identity.local_os_user_anchor.windows_source, 'verified_interactive_user_sid');
  assert.equal(identity.local_os_user_anchor.request_supplied, 'forbidden');
  assert.equal(identity.principal.store_identity, 'local_app_principals');
  assert.equal(identity.record.store_identity, 'local_app_records');
  assert.equal(identity.store_separation.principal_and_record_are_distinct_records, true);
  assert.equal(identity.store_separation.app_id_positive_key, 'forbidden');
  assert.deepEqual(grant.grant.key, [
    'local_os_user_anchor',
    'account_id',
    'local_app_principal_id',
    'capability_resource_fingerprint',
  ]);
  assert.equal(grant.store_separation.principal_record_store_dependency, 'reference_only');
  assert.equal(grant.store_separation.launch_session_store_dependency, 'none');
});

test('platform profiles preserve the Windows chain and macOS UDS requirement', () => {
  const principals = parseAuthority(AUTHORITY_PATHS.runtimePrincipals);
  const transports = parseAuthority(AUTHORITY_PATHS.osProfiles);
  const windows = principals.profiles.find((row) => row.os === 'windows');
  const windowsTransport = transports.profiles.find((row) => row.os === 'windows');
  const macosTransport = transports.profiles.find((row) => row.os === 'macos');
  assert.equal(principals.neutral_contract.production_runtime_execution_mode, 'isolated_os_service_principal');
  assert.equal(windows.service_control.service_name, 'NimiRuntime');
  assert.equal(principals.desktop_service_control.desktop_direct_spawn, 'forbidden');
  assert.equal(windows.principal_constraints.scm_account, 'LocalSystem');
  assert.equal(windows.principal_constraints.token_user_sid, 'S-1-5-18');
  assert.equal(windows.acceptance_isolation.runtime_lifecycle_and_restart, 'real_scm_service');
  assert.equal(principals.service_acceptance_contract.test_only_service_principal, 'forbidden');
  assert.equal(windowsTransport.endpoint_kind, 'named_pipe');
  assert.equal(macosTransport.admission, 'requirements_only_fail_closed_pending_native_admission');
  assert.equal(macosTransport.endpoint_kind, 'filesystem_unix_domain_socket');
  assert.match(macosTransport.client_peer_verification, /kernel_peer_credentials/u);
});

test('0K package operations are opaque typed-unavailable seams, not active SDK methods', () => {
  const lifecycle = parseAuthority(AUTHORITY_PATHS.lifecycle);
  const sdk = parseAuthority(AUTHORITY_PATHS.sdkGroups);
  assert.equal(lifecycle.package_seam.positive_disposition, 'typed_unavailable');
  assert.equal(lifecycle.package_seam.fields_authorize, false);
  assert.equal(lifecycle.package_seam.producer_admission, 'deferred_to_0p_or_p');
  const appGroup = sdk.groups.find((row) => row.group === 'app_lifecycle_service_projection');
  const excluded = new Set(appGroup.excluded_methods.map((row) => row.method));
  for (const method of [
    'PrepareAppLifecycleIntent',
    'GetAppLifecycleIntentStatus',
    'InstallApp',
    'UninstallApp',
    'GetAppInstallJob',
    'ListAppInstallJobs',
    'WatchAppInstallJobEvents',
    'UpdateApp',
    'HealthRepairApp',
  ]) {
    assert.equal(appGroup.methods.includes(method), false, `${method} must not be active`);
    assert.equal(excluded.has(method), true, `${method} must retain a typed-unavailable SDK exclusion`);
  }
});

test('portable material and production/test trust conversion remain forbidden', () => {
  const matrix = parseAuthority(AUTHORITY_PATHS.transport);
  const lifecycle = parseAuthority(AUTHORITY_PATHS.lifecycle);
  const grant = parseAuthority(AUTHORITY_PATHS.grant);
  const trust = parseAuthority(AUTHORITY_PATHS.trust);
  assert.equal(matrix.portable_privileged_session, 'forbidden');
  assert.equal(matrix.request_role_selection, 'forbidden');
  assert.equal(lifecycle.local_app_launch.portable_lease_or_session, 'forbidden');
  assert.deepEqual(grant.forbidden_outputs.slice(0, 4), [
    'bearer',
    'token',
    'portable_grant_credential',
    'session_proof',
  ]);
  assert.equal(trust.production_runtime_accepts_test_trust_set, false);
  assert.equal(trust.test_runtime_accepts_production_account_custody, false);
  assert.equal(trust.production_runtime_trusts_user_selected_executable, false);
  assert.equal(trust.trust_sets.some((row) => row.trust_set_id === 'nimi-runtime-e2e-fixture-v1'), false);
  const windowsTrust = trust.platform_verification_profiles.find((row) => row.os === 'windows');
  const macosTrust = trust.platform_verification_profiles.find((row) => row.os === 'macos');
  assert.equal(windowsTrust.admission, 'admitted_same_open_object_authenticode');
  assert.match(windowsTrust.native_release_verification, /WinVerifyTrust/u);
  assert.equal(macosTrust.admission, 'requirements_only_fail_closed_pending_native_admission');
  assert.match(macosTrust.native_release_verification, /dynamic_SecCode/u);
});

test('negative fixtures are independent and cover every stable issue code', () => {
  assert.deepEqual(fixtures.map((fixture) => fixture.code), expectedCodes);
  assert.equal(new Set(fixtures.map((fixture) => fixture.fixture_id)).size, fixtures.length);
  assert.equal(new Set(fixtures.map((fixture) => `${fixture.target}\n${fixture.mutation.from}`)).size, fixtures.length);
  for (const fixture of fixtures) {
    assert.match(fixture.target, /^\.nimi\/spec\//u);
    assert.equal(fixture.mutation.kind, 'replace_exact');
    assert.match(fixture.mutation.from, /\S/u);
    assert.match(fixture.mutation.to, /\S/u);
    assert.notEqual(fixture.mutation.from, fixture.mutation.to);
  }
});

test('each independent negative fixture produces exactly its stable issue code', () => {
  const report = runNegativeFixtures(loadAuthorityBundle(repoRoot), fixtures);
  assert.deepEqual(report.map((row) => row.code), expectedCodes);
  assert.deepEqual(new Set(report.map((row) => row.issue_count)), new Set([1]));
});

test('fixture report exercises the CLI and emits the same independent failures', () => {
  const result = runGate(['--fixture-report-json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.fixtures.map((row) => row.code), expectedCodes);
  assert.deepEqual(new Set(report.fixtures.map((row) => row.issue_count)), new Set([1]));
});

for (const mode of MODES) {
  test(`${mode} accepts the final 0K authority bundle`, () => {
    const result = runGate(['--mode', mode]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`${mode}: OK`, 'u'));
  });
}

test('unknown gate modes fail closed with a stable argument code', () => {
  const result = runGate(['--mode', 'unknown-mode']);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /ARGUMENT_ERROR/u);
});
