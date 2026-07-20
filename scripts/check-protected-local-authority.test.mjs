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
  'PERMISSION_LIFECYCLE_ADMISSION_REQUIRED',
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
  'MACOS_LOCAL_DEVELOPMENT_PROFILE_REQUIRED',
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
    'bundled_avatar_host',
  ]);
  assert.deepEqual(matrix.open_local_app_session_wire.request.fields, []);
  assert.deepEqual(matrix.open_local_app_session_wire.request.request_metadata_authority_inputs, []);
  assert.equal(matrix.open_local_app_session_wire.request.unknown_field_disposition, 'reject');
  assert.equal(matrix.open_local_app_session_wire.atomic_transition, 'launch_lease_consume_and_private_local_app_session_insert');
  const open = matrix.methods.find((row) => row.method_id.endsWith('/OpenLocalAppSession'));
  assert.deepEqual(open.allowed_transport_classes, ['local_app_bootstrap']);
  assert.deepEqual(open.required_origin_roles, ['local_app_process']);
  assert.deepEqual(matrix.renew_local_app_session_wire.request.fields, []);
  assert.deepEqual(matrix.renew_local_app_session_wire.request.request_metadata_authority_inputs, []);
  assert.equal(matrix.renew_local_app_session_wire.request.unknown_field_disposition, 'reject');
  assert.equal(matrix.renew_local_app_session_wire.atomic_transition, 'revoke_previous_private_session_and_insert_replacement_on_same_connection');
  const renew = matrix.methods.find((row) => row.method_id.endsWith('/RenewLocalAppSession'));
  assert.deepEqual(renew.allowed_transport_classes, ['local_app_host']);
  assert.deepEqual(renew.required_origin_roles, ['local_app_session']);
});

test('every method resolves through one platform-neutral transport binding and G5 keeps current behavior', () => {
  const matrix = parseAuthority(AUTHORITY_PATHS.transport);
  assert.equal(matrix.methods.length, matrix.method_platform_binding.declared_method_count);
  assert.equal(matrix.method_platform_binding.coverage, 'every_methods_row');
  assert.equal(matrix.method_platform_binding.resolver, 'transport_class_bindings');
  assert.equal(matrix.method_platform_binding.missing_or_ambiguous_binding, 'fail_generation');
  assert.equal(matrix.verified_platform_transport.transport_profile_ref, 'protected-local-os-profiles.yaml#same-os');
  assert.equal(matrix.verified_platform_transport.cross_platform_profile_mix, 'forbidden');
  for (const row of matrix.methods) {
    for (const transportClass of row.allowed_transport_classes) {
      assert.ok(matrix.transport_class_bindings[transportClass], `${row.method_id} has no platform binding for ${transportClass}`);
    }
    if (row.generic_proxy !== undefined) assert.equal(row.generic_proxy, 'forbidden');
  }
  assert.equal(matrix.blocked_or_unadmitted.generic_proxy, 'forbidden');
  for (const transportClass of ['desktop_control', 'local_app_bootstrap', 'local_app_host']) {
    assert.equal(matrix.transport_class_bindings[transportClass].binding, 'verified_platform_transport');
  }
  assert.equal(matrix.g5_supervisor_profile_consistency.structure_status, 'reserved_without_current_assertion_behavior_change');
  assert.equal(matrix.g5_supervisor_profile_consistency.current_assertion.command, 'pnpm check:local-development-supervisor-parity');
  assert.equal(matrix.g5_supervisor_profile_consistency.current_assertion.behavior, 'unchanged_exact_dual_supervisor_cross_assertion');
  const macos = matrix.g5_supervisor_profile_consistency.per_platform.find((row) => row.os === 'macos');
  assert.equal(macos.admission, 'requirements_only_fail_closed_pending_native_admission');
  assert.deepEqual(macos.implementation_bindings, []);
});

test('SID anchor and principal/record stores are separate while permission storage is absent', () => {
  const identity = parseAuthority(AUTHORITY_PATHS.principalRecord);
  const grant = parseAuthority(AUTHORITY_PATHS.grant);
  assert.equal(identity.local_os_user_anchor.platform_profile_ref, 'protected-local-os-profiles.yaml#same-os');
  assert.equal(identity.local_os_user_anchor.profile_field, 'local_os_user_anchor_derivation');
  assert.deepEqual(identity.local_os_user_anchor.platform_sources, {
    windows: 'verified_interactive_user_sid',
    linux: 'verified_peer_uid_and_login_session',
    macos: 'verified_peer_euid_and_audit_session',
  });
  assert.equal(identity.local_os_user_anchor.request_supplied, 'forbidden');
  assert.equal(identity.principal.store_identity, 'local_app_principals');
  assert.equal(identity.record.store_identity, 'local_app_records');
  assert.equal(identity.store_separation.principal_and_record_are_distinct_records, true);
  assert.equal(identity.store_separation.app_id_positive_key, 'forbidden');
  assert.equal(grant.current_admission.store_identity, 'absent_pre_admission');
  assert.equal(grant.current_admission.positive_mutation_path, 'absent');
  assert.deepEqual(grant.future_owner_lifecycle.key, [
    'local_os_user_anchor',
    'account_id',
    'local_app_principal_id',
    'permission_id',
    'owner_selector_digest',
  ]);
  assert.equal(grant.authority_classes.base_entitlement.permission_record, 'forbidden');
  assert.equal(grant.authority_classes.app_owned_authority.permission_record, 'forbidden');
});

test('platform profiles preserve the Windows chain and macOS UDS requirement', () => {
  const principals = parseAuthority(AUTHORITY_PATHS.runtimePrincipals);
  const transports = parseAuthority(AUTHORITY_PATHS.osProfiles);
  const custody = parseAuthority(AUTHORITY_PATHS.custodyProfiles);
  const windows = principals.profiles.find((row) => row.os === 'windows');
  const macosPrincipalDevelopment = principals.non_product_local_development_profiles
    .find((row) => row.profile_id === 'macos_local_development_v1');
  const macosCustodyDevelopment = custody.non_product_local_development_profiles
    .find((row) => row.profile_id === 'macos_local_development_v1');
  const windowsTransport = transports.profiles.find((row) => row.os === 'windows');
  const macosTransport = transports.profiles.find((row) => row.os === 'macos');
  assert.equal(principals.neutral_contract.production_runtime_execution_mode, 'isolated_os_service_principal');
  assert.equal(windows.service_control.service_name, 'NimiRuntime');
  assert.equal(principals.desktop_service_control.desktop_direct_spawn, 'forbidden');
  assert.equal(windows.principal_constraints.scm_account, 'LocalSystem');
  assert.equal(windows.principal_constraints.token_user_sid, 'S-1-5-18');
  assert.equal(windows.acceptance_isolation.runtime_lifecycle_and_restart, 'real_scm_service');
  assert.equal(macosPrincipalDevelopment.principal_constraints.account_uid_gid_minimum, 450);
  assert.equal(macosPrincipalDevelopment.principal_constraints.account_uid_gid_maximum, 499);
  assert.equal(macosPrincipalDevelopment.principal_constraints.password_record_value, '*');
  assert.equal(macosPrincipalDevelopment.principal_carrier_contract_version, 4);
  assert.equal(macosPrincipalDevelopment.principal_constraints.authentication_authority_posture, 'absent_required');
  assert.deepEqual(macosPrincipalDevelopment.principal_constraints.forbidden_authentication_material_attributes, [
    'dsAttrTypeStandard:AuthenticationAuthority',
    'dsAttrTypeNative:ShadowHashData',
    'dsAttrTypeStandard:PasswordPlus',
    'dsAttrTypeStandard:AltSecurityIdentities',
    'dsAttrTypeStandard:AuthCredential',
    'dsAttrTypeStandard:AuthMethod',
    'dsAttrTypeStandard:AuthenticationHint',
    'dsAttrTypeStandard:KDCAuthKey',
    'dsAttrTypeStandard:KerberosServices',
    'dsAttrTypeStandard:KerberosRealm',
    'dsAttrTypeNative:KerberosKeys',
    'dsAttrTypeNative:HeimdalSRPKey',
    'dsAttrTypeNative:SecureTokenVerifierHistory',
    'dsAttrTypeNative:AutoGrantSecureToken',
    'dsAttrTypeNative:LinkedIdentity',
  ]);
  assert.equal(macosPrincipalDevelopment.principal_constraints.generated_uid, 'distinct_valid_UUID_required_for_user_and_group');
  assert.equal(macosPrincipalDevelopment.principal_constraints.directory_service_api, 'public_OpenDirectory_framework_ODNode_createRecord_only');
  assert.match(macosPrincipalDevelopment.principal_constraints.directory_service_commit_policy, /journal.*ODNode_createRecord.*GeneratedUID.*no_AuthenticationAuthority.*fresh_exact-signed_real-root_helper_process.*OpenDirectory_and_POSIX/u);
  assert.match(macosPrincipalDevelopment.principal_constraints.directory_service_recovery_policy, /deletes_user_before_group.*proves_both_records_absent/u);
  assert.deepEqual(macosPrincipalDevelopment.principal_constraints.directory_service_mutation_fallbacks, [
    'dscl_forbidden', 'sysadminctl_forbidden', 'dsimport_forbidden', 'direct_dslocal_write_forbidden',
  ]);
  assert.equal(
    macosPrincipalDevelopment.acceptance_isolation.development_state_lineage_root_acl,
    'root_installation_boundary_and_dedicated__nimiruntimedev_state_only',
  );
  assert.equal(
    macosCustodyDevelopment.signing_keychain_password_commit_policy,
    'bootstrap_signing_keychain_password_exists_in_memory_only_and_is_zeroized_after_transaction;_the_final_helper_must_be_locally_CA_signed_and_its_exact_cdhash_known_before_one_System_Keychain_generic_password_insert;_the_item_is_born_with_exact_final-helper-only_decrypt_delete_changeACL_and_partition_ACLs;_bootstrap_helper_never_reads_owns_or_deletes_the_durable_item;_a_fresh_final_signed_helper_process_must_reopen_and_validate_custody_without_interaction;_rollback_and_unprovision_first_verify_the_exact_final-helper_and_item_ACLs_then_delete_the_signing-Keychain_then_delete_the_exact_item_reference_and_prove_absence_before_removing_public_trust_or_unlinking_the_final-helper;_failure_preserves_the_final-helper_cleanup-record_and_public-trust-until_unlock-secret_deletion_is_proven',
  );
  assert.match(macosCustodyDevelopment.signing_unprovision_repair_policy, /repair-only.*embedded_chain.*cleanup-record_fingerprint.*must_not_read_or_delete_the_secret/u);
  assert.equal(macosCustodyDevelopment.signing_bootstrap_helper_path, '/usr/local/libexec/nimi-macos-dev-security-bootstrap');
  assert.match(macosCustodyDevelopment.signing_acl_identity_digest_policy, /opaque_SecTrustedApplication.*public_profile_v4.*must_not_recreate_or_interpret.*all_five_role_private_keys.*System_Keychain_profile_private_keys/u);
  assert.match(macosCustodyDevelopment.signing_helper_identity_transition_policy, /immutable_root_owned_linker_signed_bootstrap.*non-durable_P256_CA_private_key.*never_enters_any_Keychain.*helper-role_private_key.*password-unlocked_signing_Keychain/u);
  assert.match(macosCustodyDevelopment.signing_helper_identity_transition_policy, /record-signer_Runtime_Desktop_and_local-host_role_keys.*same_unlocked_signing_Keychain.*zero_profile_private_keys_are_admitted_in_System_Keychain/u);
  assert.match(macosCustodyDevelopment.signing_helper_identity_transition_policy, /success_requires_bootstrap_absent_zero_transitional_ACLs_zero_System_profile_private_keys_and_no_durable_CA_private_key/u);
  assert.match(macosCustodyDevelopment.unprovision_residual_identity_closure, /present_signing-Keychain_unlock-secret_requires_the_exact_verified_final_helper.*zero_System_Keychain_profile_private_keys_are_admitted.*zero_fixed_profile_key_certificate_password_trust/u);
  assert.equal(principals.service_acceptance_contract.test_only_service_principal, 'forbidden');
  assert.equal(windowsTransport.endpoint_kind, 'named_pipe');
  assert.equal(macosTransport.admission, 'requirements_only_fail_closed_pending_native_admission');
  assert.equal(macosTransport.endpoint_kind, 'filesystem_unix_domain_socket');
  assert.match(macosTransport.client_peer_verification, /LOCAL_PEERTOKEN.*audit_session/u);
  const macosDevelopment = transports.non_product_local_development_profiles
    .find((row) => row.profile_id === 'macos_local_development_v1');
  assert.equal(transports.platform_admission.macos, 'requirements_only_fail_closed_pending_native_admission');
  assert.equal(transports.platform_admission.macos_local_development, 'local_development_non_product_admitted');
  assert.equal(macosDevelopment.production_verifier_contains_profile_root, false);
  assert.equal(macosDevelopment.desktop_socket_path, '/private/var/run/nimi-dev/runtime-desktop.sock');
  assert.match(macosDevelopment.client_peer_verification, /leaf_SPKI/u);
});

test('launch session profiles preserve the admitted Windows chain and macOS atomic requirement', () => {
  const launchSession = parseAuthority(AUTHORITY_PATHS.launchSession);
  const windows = launchSession.profiles.find((row) => row.os === 'windows');
  const macos = launchSession.profiles.find((row) => row.os === 'macos');
  assert.equal(launchSession.neutral_contract.session_open_request, 'empty');
  assert.equal(launchSession.neutral_contract.portable_lease_or_session, 'forbidden');
  assert.equal(launchSession.neutral_contract.renderer_or_app_authority_projection, 'forbidden');
  assert.equal(windows.admission, 'admitted_fixed_service_child_carrier');
  assert.match(windows.local_app_bootstrap_carrier, /named_pipe/u);
  assert.match(windows.launch_session_equivalent, /atomically_consumes_bootstrap/u);
  assert.equal(macos.admission, 'requirements_only_fail_closed_pending_native_admission');
  assert.match(macos.desktop_control_carrier, /launchd_socket_activated_DesktopControl_filesystem_uds/u);
  assert.match(macos.child_process_witness, /LOCAL_PEERTOKEN_pidversion_dynamic_SecCode/u);
  assert.match(macos.launch_session_equivalent, /atomically_consumes_bootstrap/u);
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
  for (const field of ['bearer', 'token', 'permission_decision_id', 'session_proof']) {
    assert.equal(grant.forbidden_public_fields.includes(field), true, `${field} must remain private`);
  }
  assert.equal(trust.production_runtime_accepts_test_trust_set, false);
  assert.equal(trust.production_runtime_accepts_local_development_trust_set, false);
  assert.equal(trust.local_development_runtime_accepts_production_trust_set, false);
  assert.equal(trust.test_runtime_accepts_production_account_custody, false);
  assert.equal(trust.production_runtime_trusts_user_selected_executable, false);
  assert.equal(trust.trust_sets.some((row) => row.trust_set_id === 'nimi-runtime-e2e-fixture-v1'), false);
  const windowsTrust = trust.platform_verification_profiles.find((row) => row.os === 'windows');
  const macosTrust = trust.platform_verification_profiles.find((row) => row.os === 'macos');
  assert.equal(windowsTrust.admission, 'admitted_same_open_object_authenticode');
  assert.match(windowsTrust.native_release_verification, /WinVerifyTrust/u);
  assert.equal(macosTrust.admission, 'requirements_only_fail_closed_pending_native_admission');
  assert.match(macosTrust.native_release_verification, /dynamic_SecCode/u);
  assert.equal(trust.release_trust_record_schema.schema_version, 2);
  assert.equal(trust.release_trust_record_schema.local_development_signature, 'ECDSA_P256_SHA256_DER_over_canonical_record_without_signature');
  const localSigner = trust.signer_policies.find((row) => row.signer_policy_id === 'nimi-macos-local-development-signing-policy');
  assert.equal(localSigner.identity_class, 'local_ca');
  assert.equal(localSigner.team_id_posture, 'exact_empty_required');
  assert.equal(localSigner.notarization_posture, 'absent_and_must_not_be_claimed');
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
