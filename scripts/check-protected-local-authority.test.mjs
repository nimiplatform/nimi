import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gatePath = path.join(scriptDir, 'check-protected-local-authority.mjs');
const fixtures = JSON.parse(fs.readFileSync(
  path.join(scriptDir, 'testdata/protected-local-authority/negative-fixtures.json'),
  'utf8',
));

const modes = [
  'protected-local-authority',
  'protected-rpc-posture',
  'no-portable-privileged-session',
  'protected-local-trust-set-isolation',
];

const expectedCodes = [
  'RUNTIME_OS_PRINCIPAL_ISOLATION_REQUIRED',
  'USER_SCOPED_CUSTODY_FORBIDDEN',
  'WINDOWS_CUSTODY_PRINCIPAL_BINDING_REQUIRED',
  'WINDOWS_RUNTIME_PRINCIPAL_SELECTION_REQUIRED',
  'WINDOWS_RESTRICTED_PIPE_BOOTSTRAP_REQUIRED',
  'MUTUAL_ENDPOINT_AUTH_REQUIRED',
  'LOCAL_DEVELOPMENT_CARRIER_AUTHORITY_REQUIRED',
  'RUNTIME_EXECUTABLE_TRUST_REQUIRED',
  'TRANSPORT_ROLE_MATRIX_REQUIRED',
  'PUBLIC_PRIVILEGED_RPC_FORBIDDEN',
  'PORTABLE_PRIVILEGE_FORBIDDEN',
  'BINDING_ONLY_REQUIRED',
  'PRODUCTION_TEST_TRUST_ISOLATION_REQUIRED',
  'SAME_FILE_EXECUTABLE_VERIFICATION_REQUIRED',
  'PROCESS_LIVENESS_REQUIRED',
  'LIMITED_DURABLE_ANCHOR_REQUIRED',
  'LIFECYCLE_OPERATION_TRANSACTION_REQUIRED',
  'LIFECYCLE_OPERATION_PROTOCOL_REQUIRED',
  'A1_CHILD_CHANNEL_DEPENDENCY_REQUIRED',
  'BINDING_ONLY_APP_MODE_CEILING_REQUIRED',
  'PUBLIC_REFRESH_FORBIDDEN',
  'SECURITY_LIMIT_SCHEMA_INVALID',
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

function readAuthority(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function extractContractRule(source, ruleId) {
  const start = source.indexOf(`## ${ruleId} `);
  assert.notEqual(start, -1, `missing ${ruleId}`);
  const end = source.indexOf('\n## ', start + 3);
  return source.slice(start, end === -1 ? source.length : end);
}

function runtimeStringConstants(relative, typeName) {
  const source = readAuthority(relative);
  return [...source.matchAll(new RegExp(`${typeName}\\s*=\\s*"([^"]+)"`, 'gu'))].map((match) => match[1]);
}

test('supported OS authority uses exact isolated principals and macOS privileged XPC', () => {
  const principals = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-runtime-principal-profiles.yaml');
  const profiles = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-os-profiles.yaml');
  assert.deepEqual(principals.profiles.map((row) => row.production_principal), [
    'LocalSystem_token_user_with_restricted_NT_SERVICE_NimiRuntime_authorization_principal',
    'dedicated_nimi_runtime_system_uid',
    'dedicated_nimi_runtime_launchdaemon_principal',
  ]);
  const macos = profiles.profiles.find((row) => row.os === 'macos');
  assert.equal(macos.endpoint_kind, 'privileged_xpc_service');
  assert.equal(macos.endpoint_ownership, 'launchdaemon_privileged_xpc_mach_service');
});

test('Windows custody binds local-user encryption to the fixed service host and exact restricted service SID', () => {
  const principals = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-runtime-principal-profiles.yaml');
  const windows = principals.profiles.find((row) => row.os === 'windows');
  assert.deepEqual(principals.windows_service_host, {
    scm_account: 'LocalSystem',
    token_user_sid: 'S-1-5-18',
    dpapi_ng_descriptor: 'LOCAL=user',
    cryptographic_scope: 'local_system_token_user_sid_S-1-5-18',
    state_acl_scope: 'exact_restricted_service_sid_only',
    process_dacl_scope: 'service_sid_full_authority_interactive_read_only_sync_query_limited_read_control',
    process_mandatory_label_scope: 'system_integrity_no_write_up_only_read_control_remains_available_for_mutual_verification',
    active_logon_query_authority: 'local_system_required_for_cross_session_WTSSessionInfo_and_exact_LSA_logon_record',
    local_machine_descriptor_allowed: false,
    system_or_administrator_compromise: 'outside_current_threat_boundary',
  });
  assert.equal(windows.custody_store, 'dpapi_ng_local_user_fixed_local_system_host_plus_exact_service_sid_acl_state');
  assert.deepEqual(principals.windows_principal_selection, {
    authority_status: 'admitted',
    selected_profile: 'local_system_host_with_restricted_service_sid',
    selected_fixture: 'NimiRuntimeE2E',
    selected_fixture_result: 'elevated_installer_fixture_green_unelevated_mutual_peer_blocked_process_read_control',
    product_closeout_implication: 'none_authority_selection_only',
    a5_closeout_status: 'blocked',
    rejected_candidate: 'NT_SERVICE_NimiRuntimeE2EVirtual_virtual_account',
    rejected_fixture_result: 'fail_closed_pipe_active_session_info_access_ERROR_ACCESS_DENIED',
    rejection_boundary: 'WTSQuerySessionInformation_for_another_user_requires_Query_Information_and_exact_LsaGetLogonSessionData_requires_session_owner_or_local_system_administrator',
    privilege_grant_to_rescue_virtual_account: 'forbidden',
    rationale: 'exact_active_logon_bootstrap_without_interactive_user_token_retention_requires_LocalSystem_host',
  });
});

test('Windows restricted service binds the connected process AuthenticationId before exposing NetConn', () => {
  const profiles = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-os-profiles.yaml');
  const principals = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-runtime-principal-profiles.yaml');
  const windows = profiles.profiles.find((row) => row.os === 'windows');
  const windowsPrincipal = principals.profiles.find((row) => row.os === 'windows');
  assert.deepEqual(profiles.windows_restricted_service_bootstrap, {
    active_identity_source: 'WTSGetActiveConsoleSessionId_and_WTSSessionInfo',
    user_token_preopen: 'forbidden',
    endpoint_acl_subject: 'active_account_sid_connect_only',
    account_partition: 'user_sid_terminal_session_id_wts_logon_time',
    active_session_revalidation: 'connection_liveness_revoked_on_wts_account_session_or_logon_time_change',
    post_connect_identity: 'GetNamedPipeClientProcessId_then_process_token_logon_sid_AuthenticationId_LsaGetLogonSessionData_before_NetConn',
    post_connect_executable: 'same_open_hfile_native_trust',
    mismatch_disposition: 'reject_close_and_reopen',
    exact_logon_correlation: {
      fields: ['account_sid', 'terminal_session_id', 'wts_logon_time', 'token_logon_sid', 'token_authentication_id', 'lsa_logon_time', 'interactive_logon_type', 'active_console'],
      allowed_logon_types: ['interactive', 'remote_interactive', 'cached_interactive', 'cached_remote_interactive'],
      lsa_lookup_key: 'token_statistics_authentication_id_exact',
      time_rule: 'lsa_logon_time_positive_and_not_after_wts_session_logon_time',
      enumeration_or_first_candidate_selection: 'forbidden',
    },
  });
  assert.equal(windows.endpoint_ownership, 'first_pipe_instance_service_owned_dacl_connect_only_active_account_sid_remote_clients_rejected');
  assert.equal(windows.client_peer_verification, 'GetNamedPipeClientProcessId_token_logon_sid_AuthenticationId_exact_LSA_record_active_WTS_session_and_same_file_executable_trust_before_NetConn');
  assert.equal(windows.server_peer_verification, 'GetNamedPipeServerProcessId_SCM_service_binding_exact_service_token_read_only_process_DACL_and_same_file_runtime_trust_before_protocol_bytes');
  assert.equal(windowsPrincipal.endpoint_connect_boundary, 'named_pipe_acl_grants_connect_only_to_active_account_sid_and_service_sid_then_exact_process_token_LSA_and_active_WTS_verification_before_NetConn');
  assert.equal(windowsPrincipal.process_isolation, 'service_process_dacl_denies_interactive_sensitive_rights_and_allows_only_sync_query_limited_read_control_for_mutual_runtime_verification');
});

test('local development shares the native installed_host carrier without parallel transport or origin truth', () => {
  const contract = readAuthority('.nimi/spec/runtime/kernel/protected-local-session-contract.md');
  const transportRule = extractContractRule(contract, 'K-PLOCAL-002');
  const matrix = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml');
  const identity = parseAuthority('.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml');
  const artifact = parseAuthority('.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/audit-artifact-workflow.yaml');
  const expectedTransports = ['public_tcp', 'desktop_control', 'launch_bootstrap', 'installed_host'];
  const expectedRoles = [
    'binding_only',
    'verified_desktop_process',
    'desktop_account_host',
    'desktop_lifecycle_host',
    'verified_installed_process',
    'installed_host_session',
    'verified_local_development_process',
    'local_development_host_session',
  ];

  assert.doesNotMatch(transportRule, /`development_(?:bootstrap|host)`/u);
  for (const transport of expectedTransports) assert.match(transportRule, new RegExp(`\\b${transport}\\b`, 'u'));
  assert.deepEqual(matrix.transport_classes, expectedTransports);

  const runtimeTransports = runtimeStringConstants('runtime/internal/protectedlocal/core.go', 'TransportClass');
  const runtimeRoles = [
    ...runtimeStringConstants('runtime/internal/protectedlocal/core.go', 'OriginRole'),
    ...runtimeStringConstants('runtime/internal/protectedlocal/installed_launch_connection.go', 'OriginRole'),
  ];
  assert.deepEqual(runtimeTransports, expectedTransports);
  assert.deepEqual(runtimeRoles, expectedRoles);
  assert.deepEqual(matrix.origin_roles, expectedRoles);

  const postureRows = [...identity.methods, ...artifact.methods];
  for (const methodId of [
    '/nimi.runtime.v1.RuntimeDevelopmentService/OpenLocalDevelopmentAppSession',
    '/nimi.runtime.v1.RuntimeDevelopmentService/GetLocalDevelopmentSessionStatus',
    '/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes',
  ]) {
    const matrixRow = matrix.methods.find((row) => row.method_id === methodId);
    const postureRow = postureRows.find((row) => row.method_id === methodId);
    assert.ok(matrixRow && postureRow, `missing transport/posture row for ${methodId}`);
    assert.deepEqual(matrixRow.allowed_transport_classes, [postureRow.protected_transport_class]);
    const postureRoles = postureRow.required_origin_roles ?? [postureRow.required_origin_role];
    assert.deepEqual(matrixRow.required_origin_roles, postureRoles);
  }

  const readArtifact = matrix.methods.find((row) => row.method_id === '/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes');
  assert.deepEqual(readArtifact.required_origin_roles, ['installed_host_session', 'local_development_host_session']);
  const runtimeCarrier = readAuthority('runtime/internal/grpcserver/installed_transport.go');
  assert.match(runtimeCarrier, /protectedReadArtifactBytesMethod[\s\S]*RoleInstalledHostSession[\s\S]*RoleLocalDevelopmentHostSession/u);

  const closedVocabulary = `${transportRule}\n${JSON.stringify(matrix)}\n${JSON.stringify(identity)}\n${JSON.stringify(artifact)}`;
  assert.doesNotMatch(closedVocabulary, /`development_(?:bootstrap|host)`|"development_(?:bootstrap|host)"|verified_app_host_session/u);
  const admittedRoles = new Set(expectedRoles);
  for (const row of matrix.methods) {
    for (const role of row.required_origin_roles) assert.ok(admittedRoles.has(role), `fictional matrix role ${role}`);
  }
});

test('production config and Desktop service lifecycle have one closed authority', () => {
  const principals = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-runtime-principal-profiles.yaml');
  const config = parseAuthority('.nimi/spec/runtime/kernel/tables/config-schema.yaml');
  assert.deepEqual(principals.desktop_service_control, {
    status_authority: 'os_service_manager_and_verified_runtime_control',
    start_or_restart_authority: 'typed_os_service_control_gateway',
    operations: ['status', 'start', 'restart'],
    product_stop_operation: 'absent',
    desktop_direct_spawn: 'forbidden',
    desktop_direct_stop: 'forbidden',
    desktop_quit_disposition: 'service_remains_running',
    release_staging_authority: 'signed_installer_service_updater',
    runtime_binary_selection_by_desktop: 'forbidden',
    common_response_fields: ['state', 'release_id', 'reason_code', 'retryable'],
    state_values: ['stopped', 'start_pending', 'running', 'restart_pending', 'unavailable'],
    windows: {
      service_name: 'NimiRuntime',
      status_semantics: 'scm_query_status_then_verified_runtime_health_when_running',
      start_semantics: 'scm_start_fixed_service_name_without_binary_path_or_arguments',
      restart_semantics: 'runtime_self_exit_then_scm_recovery_start_and_new_boot_epoch_verification',
      desktop_scm_access: ['SERVICE_QUERY_STATUS', 'SERVICE_START'],
      desktop_scm_stop_access: 'forbidden',
      service_binary_path_or_arguments_input: 'forbidden',
      running_success_requirement: 'verified_new_or_existing_runtime_process_and_protected_handshake',
      restart_success_requirement: 'new_pid_creation_marker_and_runtime_boot_epoch_verified',
      hung_runtime_recovery: 'signed_installer_service_updater_or_administrator_only',
    },
  });
  assert.equal(config.production_authority?.closed_field_partition, true);
  assert.equal(config.production_authority?.interactive_user_config_file, 'forbidden');
  assert.equal(config.production_authority?.retired_import, 'forbidden_pre_release_hardcut');
});

test('every protected Desktop method uses the closed protected-origin posture', () => {
  const identity = parseAuthority('.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml');
  const protectedRows = identity.methods.filter((row) => row.protected_transport_class === 'desktop_control');
  assert.ok(protectedRows.length > 0);
  assert.deepEqual(new Set(protectedRows.map((row) => row.posture)), new Set(['protected_origin_required']));
});

test('public Runtime grant token family is deny-only and cannot bypass binding-only bootstrap', () => {
  const identity = parseAuthority('.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml');
  const grantRows = identity.methods.filter((row) => row.method_id.includes('RuntimeGrantService/'));
  assert.equal(grantRows.length, 5);
  assert.deepEqual(new Set(grantRows.map((row) => row.posture)), new Set(['deny_all_tombstone']));
  assert.deepEqual(new Set(grantRows.map((row) => row.transport_disposition)), new Set(['deny_all']));
});

test('workspace binding RPCs remain blocked until an exact protected origin is admitted', () => {
  const identity = parseAuthority('.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml');
  const transport = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml');
  for (const method of ['IssueWorkspaceBinding', 'RevokeWorkspaceBinding']) {
    const methodId = `/nimi.runtime.v1.RuntimeAccountService/${method}`;
    const posture = identity.methods.find((row) => row.method_id === methodId);
    const route = transport.methods.find((row) => row.method_id === methodId);
    assert.equal(posture?.posture, 'blocked_pending_authority');
    assert.equal(posture?.authority_status, 'blocked_pending_separate_authority');
    assert.deepEqual(route?.allowed_transport_classes, []);
    assert.deepEqual(route?.required_origin_roles, []);
    assert.equal(route?.operation_class, 'blocked_pending_separate_authority');
  }
});

test('Desktop session, Windows service control, and native trust admission have frozen minimal shapes', () => {
  const transport = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-rpc-transport-matrix.yaml');
  const principals = parseAuthority('.nimi/spec/runtime/kernel/tables/protected-local-runtime-principal-profiles.yaml');
  const trust = parseAuthority('.nimi/spec/platform/kernel/tables/protected-local-executable-trust-sets.yaml');
  assert.deepEqual(transport.open_desktop_session_wire?.request?.fields, []);
  assert.deepEqual(transport.open_desktop_session_wire?.response?.fields?.map((row) => row.name), [
    'desktop_session_id',
    'runtime_boot_epoch',
  ]);
  assert.equal(transport.open_desktop_session_wire?.renderer_projection, 'forbidden');
  assert.deepEqual(principals.desktop_service_control?.operations, ['status', 'start', 'restart']);
  assert.equal(principals.desktop_service_control?.product_stop_operation, 'absent');
  assert.equal(principals.desktop_service_control?.windows?.service_name, 'NimiRuntime');
  assert.equal(principals.desktop_service_control?.windows?.restart_semantics, 'runtime_self_exit_then_scm_recovery_start_and_new_boot_epoch_verification');
  assert.equal(trust.platform_native_release_verification?.custom_peer_release_record, 'absent');
  assert.equal(trust.platform_native_release_verification?.peer_owned_release_generation, 'forbidden');
  assert.equal(trust.platform_admission?.closeout_unit, 'os_platform');
  assert.equal(trust.platform_admission?.unadmitted_platform_disposition, 'fail_closed');
});

test('negative fixture inputs are independent and cover every stable security code', () => {
  assert.deepEqual(fixtures.map((fixture) => fixture.code), expectedCodes);
  assert.equal(new Set(fixtures.map((fixture) => fixture.fixture_id)).size, fixtures.length);
  assert.equal(new Set(fixtures.map((fixture) => fixture.mutation.to)).size, fixtures.length);
  for (const fixture of fixtures) {
    assert.match(fixture.target, /^\.nimi\/spec\//u);
    assert.equal(fixture.mutation.kind, 'replace_exact');
    assert.match(fixture.mutation.from, /\S/u);
    assert.match(fixture.mutation.to, /\S/u);
    assert.notEqual(fixture.mutation.from, fixture.mutation.to);
    assert.doesNotMatch(fixture.mutation.from, new RegExp(fixture.code, 'iu'));
    assert.doesNotMatch(fixture.mutation.to, new RegExp(fixture.code, 'iu'));
  }
});

test('gate rejects every independent negative fixture with one stable code', () => {
  const result = runGate(['--fixture-report-json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.fixtures.map((fixture) => fixture.code), expectedCodes);
  assert.equal(new Set(report.fixtures.map((fixture) => fixture.code)).size, fixtures.length);
  for (const [index, fixture] of report.fixtures.entries()) {
    assert.equal(fixture.fixture_id, fixtures[index].fixture_id);
    assert.equal(fixture.target, fixtures[index].target);
    assert.equal(fixture.issue_count, 1);
    assert.match(fixture.reason, /\S/u);
  }
});

for (const mode of modes) {
  test(`${mode} accepts the admitted A.0 authority bundle`, () => {
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
